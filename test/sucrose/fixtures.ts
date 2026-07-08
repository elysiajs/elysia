// @ts-nocheck
/**
 * Sucrose static-analysis fixture corpus.
 *
 * Each fixture pins the CONTRACT (design/sucrose-contract.md): which context
 * channels `sucrose()` must infer for a given handler shape, and the mandated
 * failure direction.
 *
 * `expect` is a PARTIAL assertion — only the listed channels are checked. This
 * lets a fixture assert its real channel(s) without coupling to unrelated
 * false-positives elsewhere in the analyzer (e.g. the H5 spurious-query bug,
 * which several return-bearing bodies trip incidentally).
 *
 * `passesToday` is determined EMPIRICALLY (see contract.test.ts, which runs the
 * corpus and cross-checks this flag) — it is NOT a guess. The H5/H26/M29/M30
 * Phase-2 fixes have all landed; every fixture now has `passesToday: true` and
 * asserts the contract directly. The flag machinery remains for pinning any
 * future open defect.
 *
 * All fixtures are given as live functions (so `.toString()` reflects the real
 * engine minifier). Minified shapes that the TS source formatter would expand
 * are produced via `eval` to defeat prettier/tsc reformatting.
 */

import type { Sucrose } from '../../src/sucrose'

type Channel = keyof Sucrose.Inference
type Expect = Partial<Record<Channel, boolean>>

export interface Fixture {
	name: string
	/** Input class this fixture exercises (see contract §"Input classes"). */
	class:
		| 'original'
		| 'minified'
		| 'rename'
		| 'nested'
		| 'default'
		| 'rest'
		| 'computed'
		| 'optional-chain'
		| 'whole-context'
		| 'method'
		| 'bound-native'
	fn: (...args: any[]) => any
	/** Partial expected inference — only these channels are asserted. */
	expect: Expect
	/** Empirically-measured: does sucrose satisfy `expect` on the current tree? */
	passesToday: boolean
	/** For failing fixtures: which contract bug they pin. */
	bug?: 'H5' | 'H26' | 'M29' | 'M30'
}

// A whole-context handler bound to `this` -> stringifies to `[native code]`.
function nativeShaped(this: any, c: any) {
	return c.query.a
}
const boundHandler = nativeShaped.bind({})

const objWithMethod = {
	method(c: any) {
		return c.query.a
	}
}

class ClassHandler {
	handle(c: any) {
		return c.body
	}
}

const ALL_TRUE: Expect = {
	query: true,
	body: true,
	headers: true,
	cookie: true,
	set: true,
	server: true,
	route: true,
	url: true,
	path: true
}

export const fixtures: Fixture[] = [
	// ─── original source ────────────────────────────────────────────────
	{
		name: 'whole-context dot access',
		class: 'whole-context',
		fn: (c: any) => c.query.a,
		expect: { query: true },
		passesToday: true
	},
	{
		name: 'destructure single key',
		class: 'original',
		fn: ({ query }: any) => query.a,
		expect: { query: true },
		passesToday: true
	},
	{
		name: 'destructure multiple keys',
		class: 'original',
		fn: ({ query, body }: any) => log(query, body),
		expect: { query: true, body: true },
		passesToday: true
	},
	{
		name: 'route / url / path via whole context',
		class: 'whole-context',
		fn: (c: any) => log(c.url, c.path, c.route),
		expect: { url: true, route: true, path: true },
		passesToday: true
	},

	// ─── minified (no spaces, 1-param arrow, single-letter idents) ───────
	{
		name: 'minified 1-param arrow dot access',
		class: 'minified',
		fn: eval('c=>c.query.a'),
		expect: { query: true },
		passesToday: true
	},
	{
		name: 'minified destructuring-assignment alias',
		class: 'minified',
		// const q = c.query -> q is an alias, but nothing reads q.<chan>;
		// the const {..}=.. shape resolves query directly.
		fn: eval('c=>{const q=c.query;return sink(q)}'),
		expect: { query: true },
		passesToday: true
	},
	{
		// M29 sibling: minified two-hop alias chain reading via the LAST alias.
		// Over-slicing would drop `b`, losing the only reader of `body`.
		name: 'minified two-hop alias reads body via last alias',
		class: 'minified',
		fn: eval('c=>{const a=c,b=a;return b.body}'),
		expect: { body: true },
		passesToday: true
	},
	{
		// Minified three-hop chain: exercises the deepest transitive resolution
		// (garbage aliases would break the final `.cookie` read).
		name: 'minified three-hop alias reads cookie',
		class: 'minified',
		fn: eval('c=>{const a=c,b=a,d=b;return d.cookie}'),
		expect: { cookie: true },
		passesToday: true
	},
	{
		// Minified destructure-with-rename in the body (H26 re-inject path):
		// `{headers:h}=c` must reduce to the bare `headers` key, not `headersh`.
		name: 'minified body destructure-rename infers headers',
		class: 'minified',
		fn: eval('c=>{const{headers:h}=c;return sink(h)}'),
		expect: { headers: true },
		passesToday: true
	},

	// ─── destructure-with-rename ─────────────────────────────────────────
	{
		name: 'rename single (root param)',
		class: 'rename',
		fn: ({ query: q }: any) => opaque(q),
		expect: { query: true },
		passesToday: true
	},
	{
		name: 'rename multiple (root param)',
		class: 'rename',
		fn: ({ headers: hd, cookie: ck }: any) => opaque(hd, ck),
		expect: { headers: true, cookie: true },
		passesToday: true
	},

	// ─── nested destructure ──────────────────────────────────────────────
	{
		name: 'nested destructure query',
		class: 'nested',
		fn: ({ query: { a } }: any) => a,
		expect: { query: true },
		passesToday: true
	},
	{
		name: 'nested destructure cookie',
		class: 'nested',
		fn: ({ cookie: { auth } }: any) => auth.value,
		expect: { cookie: true },
		passesToday: true
	},

	// ─── default values ──────────────────────────────────────────────────
	{
		name: 'default primitive + sibling',
		class: 'default',
		// `body = 1` must not parse as key `body=1`; sibling `query` still seen
		fn: ({ body = 1, query }: any) => log(body, query),
		expect: { body: true, query: true },
		passesToday: true
	},
	{
		name: 'default object + sibling',
		class: 'default',
		fn: ({ headers = {}, cookie }: any) => log(headers, cookie),
		expect: { headers: true, cookie: true },
		passesToday: true
	},

	// ─── rest → conservative all-true ────────────────────────────────────
	{
		name: 'rest-only destructure → all-true',
		class: 'rest',
		fn: ({ ...rest }: any) => log(rest),
		expect: ALL_TRUE,
		passesToday: true
	},

	// ─── computed access ─────────────────────────────────────────────────
	{
		name: "computed double-quote c['query']",
		class: 'computed',
		fn: (c: any) => c['query'].a,
		expect: { query: true },
		passesToday: true
	},
	{
		name: "computed single-quote c['headers']",
		class: 'computed',
		fn: (c: any) => c['headers'],
		expect: { headers: true },
		passesToday: true
	},

	// ─── optional chaining ───────────────────────────────────────────────
	{
		name: 'optional chaining c?.query',
		class: 'optional-chain',
		fn: (c: any) => c?.query?.a,
		expect: { query: true },
		passesToday: true
	},
	{
		name: 'optional chaining c.server?.upgrade',
		class: 'optional-chain',
		fn: (c: any) => c.server?.upgrade,
		expect: { server: true },
		passesToday: true
	},

	// ─── context passed opaquely → all-true ──────────────────────────────
	{
		name: 'whole context passed to fn → all-true',
		class: 'whole-context',
		fn: (c: any) => log(c),
		expect: ALL_TRUE,
		passesToday: true
	},

	// ─── class / object method ───────────────────────────────────────────
	{
		name: 'object-method shorthand',
		class: 'method',
		fn: objWithMethod.method,
		expect: { query: true },
		passesToday: true
	},
	{
		name: 'class method',
		class: 'method',
		// only assert body (its real channel); a bare `return c.body` also trips
		// H5's spurious query, which we do not couple to here.
		fn: new ClassHandler().handle,
		expect: { body: true },
		passesToday: true
	},

	// ═══ DEFECT REPROS (executable Phase-2 specs) ════════════════════════

	// H5 — bare `return <alias>` falsely infers query. Contract: false-positive
	// query is a 3× per-request cost; `return <alias>` alone must NOT set query.
	{
		name: 'H5: return body-alias must not infer query',
		class: 'original',
		fn: (c: any) => {
			const b = c.body
			return b
		},
		expect: { body: true, query: false },
		passesToday: true,
		bug: 'H5'
	},
	{
		name: 'H5: return set-alias must not infer query',
		class: 'original',
		fn: (c: any) => {
			const s = c.set
			return s
		},
		expect: { set: true, query: false },
		passesToday: true,
		bug: 'H5'
	},

	// M29 — minified `=alias` over-slices by 2, dropping transitive aliases.
	// Here the SECOND alias `b` (of the whole context) is the only reader of
	// `headers`; the minified over-slice drops it → headers silently lost
	// (forbidden false-negative). Spaced form infers headers correctly.
	{
		name: 'M29: minified transitive alias drops headers',
		class: 'minified',
		fn: eval('c=>{const a=c,b=a;return b.headers}'),
		expect: { headers: true },
		passesToday: true,
		bug: 'M29'
	},

	// M30 — bound / native handlers stringify to `[native code]`; today they
	// infer all-false → every read context prop is silently undefined
	// (forbidden). Contract decision: markAllAccessed (conservative all-true).
	{
		name: 'M30: bound handler → all-true',
		class: 'bound-native',
		fn: boundHandler,
		expect: ALL_TRUE,
		passesToday: true,
		bug: 'M30'
	},
	{
		name: 'M30: native function → all-true',
		class: 'bound-native',
		fn: Array.prototype.map as any,
		expect: ALL_TRUE,
		passesToday: true,
		bug: 'M30'
	},

	// ─── $-prefixed single-param arrow (minified / bundled) ──────────────
	// Regression: `$c=>$c.query.a` crashed sucrose with TypeError because the
	// bare-arrow regex (\w+) excluded `$`, landing in the "Unknown case" which
	// returned `undefined` for body, then dereferenced it. Fix: regex → [\w$]+.
	{
		name: 'dollar-prefix single-param arrow infers query',
		class: 'minified',
		fn: eval('$c=>$c.query.a'),
		expect: { query: true },
		passesToday: true
	}
]

/**
 * Unit-level repros that live below the `sucrose()` end-to-end surface, where
 * the defect is directly observable (the end-to-end path sometimes masks it via
 * a robust re-parse). Asserted in contract.test.ts against the exported
 * internals.
 */
export interface UnitRepro {
	name: string
	bug: 'H26' | 'M29'
	/** Runs the internal, returns the observed value. */
	run: () => unknown
	/** What the internal produces TODAY (wrong). */
	today: unknown
	/** What the fix must produce. */
	fixed: unknown
}
