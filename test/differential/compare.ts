/**
 * D2 differential harness — committed comparison rules (n-proof.md P0-10).
 *
 * The COMPARISON RULES ARE THE PRODUCT: debuggability on mismatch is the point.
 * Every normalization exception below carries a why-comment. Do not add an
 * exception without one.
 *
 * ── Rules ───────────────────────────────────────────────────────────────────
 * • status         — strict equality.
 * • headers        — multiset of (lowercase-name, value). ORDER-INSENSITIVE
 *                    because HTTP header order is not semantically meaningful and
 *                    real sockets may reorder. content-length IS compared.
 *   normalization exceptions (the ONLY ones):
 *     - `date`     — STRIPPED. Real-socket (listen) lanes stamp a wall-clock
 *                    Date; app.handle() does not. Comparing it would be a clock
 *                    race, not a divergence. Stripped on BOTH sides so a lane
 *                    that emits it and one that doesn't still compare equal.
 *     - `etag`     — ignored ONLY when emitted by the candidate in the
 *                    native-static-off-vs-on@listen pair. Bun's native static
 *                    tier adds it automatically; the JS oracle cannot.
 * • set-cookie     — extracted via getSetCookie() and compared as an ORDERED
 *                    list. Cookie emission order is a contract (write-many); a
 *                    reordering IS a divergence, so it is NOT folded into the
 *                    order-insensitive header multiset.
 * • body           — exact bytes (Uint8Array from a fully-drained arrayBuffer).
 * • observations   — structural deep-equal (P0-9): object keys order-insensitive,
 *                    arrays order-sensitive. Dispatched via the comparator
 *                    registry (`comparators`) so B5 can add more later.
 */

/** A normalized, comparable snapshot of a Response. */
export interface ResponseSnapshot {
	status: number
	/** Sorted `name: value` pairs, `date` stripped, set-cookie excluded. */
	headers: Array<[string, string]>
	/** Ordered set-cookie list (getSetCookie). */
	setCookie: string[]
	/** Full response body bytes. */
	body: Uint8Array
}

/** Headers stripped from the comparison. Each MUST have a why-comment above. */
const STRIPPED_HEADERS = new Set([
	// Real-socket lanes stamp wall-clock Date; app.handle() does not. A clock,
	// not a divergence.
	'date'
])

/**
 * Fully drain a Response into a comparable snapshot. Consumes the body — pass a
 * fresh Response (never reuse across lanes).
 */
export async function snapshot(res: Response): Promise<ResponseSnapshot> {
	const setCookie =
		typeof res.headers.getSetCookie === 'function'
			? res.headers.getSetCookie()
			: []

	const headers: Array<[string, string]> = []
	for (const [name, value] of res.headers) {
		const lower = name.toLowerCase()
		if (lower === 'set-cookie') continue // ordered channel, handled separately
		if (STRIPPED_HEADERS.has(lower)) continue
		headers.push([lower, value])
	}
	headers.sort((a, b) =>
		a[0] < b[0]
			? -1
			: a[0] > b[0]
				? 1
				: a[1] < b[1]
					? -1
					: a[1] > b[1]
						? 1
						: 0
	)

	const body = new Uint8Array(await res.arrayBuffer())

	return { status: res.status, headers, setCookie, body }
}

/** Which component of the response diverged first. */
export type DivergentComponent =
	| 'status'
	| 'headers'
	| 'set-cookie'
	| 'body'
	| 'observation'

export interface Mismatch {
	corpusId: string
	requestId: string
	lanePair: string
	component: DivergentComponent
	/** Human-readable, truncated. */
	oracle: string
	candidate: string
}

const MAX = 300
const truncate = (s: string) =>
	s.length > MAX ? s.slice(0, MAX) + `…(+${s.length - MAX})` : s

const decoder = new TextDecoder('utf-8', { fatal: false })
/** Render bytes for a report: UTF-8 if it round-trips, else hex. */
const renderBody = (bytes: Uint8Array): string => {
	const text = decoder.decode(bytes)
	// If re-encoding the decoded text yields the same bytes, it was valid UTF-8.
	if (new TextEncoder().encode(text).length === bytes.length)
		return JSON.stringify(text)
	return `<${bytes.length} bytes: ${[...bytes.slice(0, 32)].map((b) => b.toString(16).padStart(2, '0')).join(' ')}${bytes.length > 32 ? '…' : ''}>`
}

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
	if (a.length !== b.length) return false
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
	return true
}

const headersEqual = (
	a: Array<[string, string]>,
	b: Array<[string, string]>
): boolean => {
	if (a.length !== b.length) return false
	for (let i = 0; i < a.length; i++)
		if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return false
	return true
}

const nativeStaticCandidateHeaders = (
	lanePair: string,
	headers: Array<[string, string]>
) =>
	lanePair === 'native-static-off-vs-on@listen'
		? headers.filter(([name]) => name !== 'etag')
		: headers

const arrayEqual = (a: string[], b: string[]): boolean =>
	a.length === b.length && a.every((v, i) => v === b[i])

const fmtHeaders = (h: Array<[string, string]>) =>
	'{' + h.map(([k, v]) => `${k}: ${v}`).join(', ') + '}'

/**
 * Compare two response snapshots. Returns the FIRST divergent component (status
 * → headers → set-cookie → body), or null if identical.
 */
export function compareResponses(
	ctx: { corpusId: string; requestId: string; lanePair: string },
	oracle: ResponseSnapshot,
	candidate: ResponseSnapshot
): Mismatch | null {
	if (oracle.status !== candidate.status)
		return {
			...ctx,
			component: 'status',
			oracle: String(oracle.status),
			candidate: String(candidate.status)
		}

	// Bun owns native-static ETags and conditional handling. Ignore only the
	// candidate ETag in this exact pair; every other lane still compares it.
	const candidateHeaders = nativeStaticCandidateHeaders(
		ctx.lanePair,
		candidate.headers
	)
	if (!headersEqual(oracle.headers, candidateHeaders))
		return {
			...ctx,
			component: 'headers',
			oracle: truncate(fmtHeaders(oracle.headers)),
			candidate: truncate(fmtHeaders(candidate.headers))
		}

	if (!arrayEqual(oracle.setCookie, candidate.setCookie))
		return {
			...ctx,
			component: 'set-cookie',
			oracle: truncate(JSON.stringify(oracle.setCookie)),
			candidate: truncate(JSON.stringify(candidate.setCookie))
		}

	if (!bytesEqual(oracle.body, candidate.body))
		return {
			...ctx,
			component: 'body',
			oracle: truncate(renderBody(oracle.body)),
			candidate: truncate(renderBody(candidate.body))
		}

	return null
}

/**
 * Structural deep equality (P0-9). Order-INSENSITIVE for object keys (a set of
 * facts is unordered), order-SENSITIVE for arrays (a hook-fire log's order IS the
 * fact). No dependencies. `JSON.stringify` would have been order-SENSITIVE for
 * object keys — a false divergence when two lanes emit the same facts in a
 * different key order — so it is deliberately NOT used for equality here.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true
	// NaN === NaN is false but they are structurally equal.
	if (typeof a === 'number' && typeof b === 'number')
		return Number.isNaN(a) && Number.isNaN(b)
	if (
		a === null ||
		b === null ||
		typeof a !== 'object' ||
		typeof b !== 'object'
	)
		return false

	const aIsArr = Array.isArray(a)
	const bIsArr = Array.isArray(b)
	if (aIsArr !== bIsArr) return false

	if (aIsArr) {
		// Arrays: order-SENSITIVE, positional compare.
		const av = a as unknown[]
		const bv = b as unknown[]
		if (av.length !== bv.length) return false
		for (let i = 0; i < av.length; i++)
			if (!deepEqual(av[i], bv[i])) return false
		return true
	}

	// Plain objects: order-INSENSITIVE over own enumerable keys.
	const ao = a as Record<string, unknown>
	const bo = b as Record<string, unknown>
	const aKeys = Object.keys(ao)
	const bKeys = Object.keys(bo)
	if (aKeys.length !== bKeys.length) return false
	for (const k of aKeys) {
		if (!Object.prototype.hasOwnProperty.call(bo, k)) return false
		if (!deepEqual(ao[k], bo[k])) return false
	}
	return true
}

/** Structural deep-equal comparison of lane observations (P0-9). */
export function compareObservations(
	ctx: { corpusId: string; requestId: string; lanePair: string },
	oracle: unknown,
	candidate: unknown
): Mismatch | null {
	if (deepEqual(oracle, candidate)) return null
	return {
		...ctx,
		component: 'observation',
		// Rendered for the report only — equality above is structural, not textual.
		oracle: truncate(JSON.stringify(oracle) ?? 'undefined'),
		candidate: truncate(JSON.stringify(candidate) ?? 'undefined')
	}
}

/**
 * Typed comparator registry (P0-9). The matrix dispatches through named
 * comparators so future tasks can register more without touching the matrix:
 * B5 will add a `flatten`-structural comparator here when it lands. A comparator
 * takes the oracle + candidate facts (already snapshotted) and returns the FIRST
 * mismatch or null. Keep it lean — a `Record` of functions, no classes.
 */
export type Comparator<T = any> = (
	ctx: { corpusId: string; requestId: string; lanePair: string },
	oracle: T,
	candidate: T
) => Mismatch | null

export const comparators: Record<string, Comparator> = {
	response: compareResponses as Comparator,
	observation: compareObservations as Comparator
}

/** Format a mismatch into a one-line, actionable report. */
export function formatMismatch(m: Mismatch): string {
	return (
		`differential mismatch [${m.lanePair}] ` +
		`corpus="${m.corpusId}" request="${m.requestId}" ` +
		`component=${m.component}\n` +
		`  oracle    : ${m.oracle}\n` +
		`  candidate : ${m.candidate}`
	)
}
