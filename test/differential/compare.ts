// Compare status, normalized headers, ordered cookies, body bytes, then
// lifecycle observations. Header order and wall-clock Date are ignored.

export interface ResponseSnapshot {
	status: number
	headers: Array<[string, string]>
	setCookie: string[]
	body: Uint8Array
}

const STRIPPED_HEADERS = new Set([
	// Socket lanes stamp wall-clock Date; app.handle does not.
	'date'
])

// Consumes the response body.
export async function snapshot(res: Response): Promise<ResponseSnapshot> {
	const setCookie =
		typeof res.headers.getSetCookie === 'function'
			? res.headers.getSetCookie()
			: []

	const headers: Array<[string, string]> = []
	for (const [name, value] of res.headers) {
		const lower = name.toLowerCase()
		if (lower === 'set-cookie') continue
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
	oracle: string
	candidate: string
}

const MAX = 300
const truncate = (s: string) =>
	s.length > MAX ? s.slice(0, MAX) + `…(+${s.length - MAX})` : s

const decoder = new TextDecoder('utf-8', { fatal: false })

function renderBody(bytes: Uint8Array) {
	const text = decoder.decode(bytes)
	if (new TextEncoder().encode(text).length === bytes.length)
		return JSON.stringify(text)

	return `<${bytes.length} bytes: ${[...bytes.slice(0, 32)].map((b) => b.toString(16).padStart(2, '0')).join(' ')}${bytes.length > 32 ? '…' : ''}>`
}

function bytesEqual(a: Uint8Array, b: Uint8Array) {
	if (a.length !== b.length) return false
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false

	return true
}

function headersEqual(a: Array<[string, string]>, b: Array<[string, string]>) {
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

const arrayEqual = (a: string[], b: string[]) =>
	a.length === b.length && a.every((v, i) => v === b[i])

const fmtHeaders = (h: Array<[string, string]>) =>
	'{' + h.map(([k, v]) => `${k}: ${v}`).join(', ') + '}'

// Return the first mismatch in status → headers → cookies → body order.
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

	// Bun adds ETags only to the promoted native-static candidate.
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

// Object key order is insignificant; array order records lifecycle order.
export function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true
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
		const av = a as unknown[]
		const bv = b as unknown[]
		if (av.length !== bv.length) return false
		for (let i = 0; i < av.length; i++)
			if (!deepEqual(av[i], bv[i])) return false
		return true
	}

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

export function compareObservations(
	ctx: { corpusId: string; requestId: string; lanePair: string },
	oracle: unknown,
	candidate: unknown
): Mismatch | null {
	if (deepEqual(oracle, candidate)) return null
	return {
		...ctx,
		component: 'observation',
		oracle: truncate(JSON.stringify(oracle) ?? 'undefined'),
		candidate: truncate(JSON.stringify(candidate) ?? 'undefined')
	}
}

export type Comparator<T = any> = (
	ctx: { corpusId: string; requestId: string; lanePair: string },
	oracle: T,
	candidate: T
) => Mismatch | null

export const comparators: Record<string, Comparator> = {
	response: compareResponses as Comparator,
	observation: compareObservations as Comparator
}

export function formatMismatch(m: Mismatch): string {
	return (
		`differential mismatch [${m.lanePair}] ` +
		`corpus="${m.corpusId}" request="${m.requestId}" ` +
		`component=${m.component}\n` +
		`  oracle    : ${m.oracle}\n` +
		`  candidate : ${m.candidate}`
	)
}
