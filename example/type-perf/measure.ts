// @ts-nocheck — throwaway perf harness, run under Bun (`bun run`), not part of
// any typecheck gate. The root tsconfig's `types: ["@types/bun"]` doesn't surface
// node globals here; not worth fighting for a script.
/**
 * Type-instantiation benchmark — schema reuse.
 *
 * Elysia resolves every route schema to a static TS type via
 * `UnwrapRoute -> UnwrapSchema -> StaticDecode` (TypeBox's `Static` machinery,
 * the dominant per-route type-check cost). TypeScript caches `Static` results by
 * schema-NODE identity, so:
 *   - N distinct inline `t.Object({...})` literals each pay full `Static`
 *     resolution (even when structurally identical — distinct nodes, distinct
 *     cache keys).
 *   - N routes referencing ONE registered `.model()` by name share a single
 *     cached `Static` resolution.
 *
 * This bench compiles three N-route apps with `tsc --extendedDiagnostics` and
 * reports `Instantiations` (the metric that scales editor/`tsc` cost). The
 * model-ref app should be materially cheaper than inline — measured ~ -31% at
 * N=50 on first authoring (2026-06-17). It is also a regression guard: the run
 * asserts ref < inline-distinct and exits non-zero if reuse ever stops working.
 *
 *   bun run example/type-perf/measure.ts [N=50]
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const N = Number(process.argv[2] ?? 50)
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..') // repo root
const tmp = join(here, '.bench-tmp')

// ── fixtures: identical handlers/route count, differ ONLY in how the body
//    schema is supplied (the variable under test) ─────────────────────────────
const head = `import { Elysia, t } from '../../../src'\n\nexport default new Elysia()\n`
const route = (i: number, schema: string) =>
	`  .post('/r${i}/:id', ${schema}, ({ body, params }) => ({ id: params.id, a: body.a${i} }))\n`

const fixtures: Record<string, string> = {
	// N DISTINCT inline literals — no `Static` cache reuse (the common worst case)
	'inline-distinct': head + Array.from({ length: N }, (_, i) =>
		route(i, `{ body: t.Object({ a${i}: t.String(), b${i}: t.Number(), c${i}: t.Boolean() }) }`)
	).join(''),
	// N STRUCTURALLY-IDENTICAL inline literals — proves same-shape does NOT dedup
	'inline-same': head + Array.from({ length: N }, (_, i) =>
		route(i, `{ body: t.Object({ a${i}: t.String(), b: t.Number(), c: t.Boolean() }) }`)
	).join(''),
	// 1 registered model, N references by name — single cached `Static`
	'model-ref':
		`import { Elysia, t } from '../../../src'\n\nexport default new Elysia()\n` +
		`  .model({ Body: t.Object({ a: t.String(), b: t.Number(), c: t.Boolean() }) })\n` +
		Array.from({ length: N }, (_, i) =>
			`  .post('/r${i}/:id', { body: 'Body' }, ({ body, params }) => ({ id: params.id, a: body.a }))\n`
		).join('')
}

// ── one tsc --extendedDiagnostics run per fixture ───────────────────────────
function measure(name: string, source: string) {
	const file = join(tmp, `${name}.ts`)
	const cfg = join(tmp, `${name}.tsconfig.json`)
	writeFileSync(file, source)
	writeFileSync(
		cfg,
		JSON.stringify({
			extends: '../../../tsconfig.test.json',
			compilerOptions: { incremental: false, noEmit: true },
			include: [`${name}.ts`]
		})
	)
	const out = spawnSync(
		'npx',
		['tsc', '--project', cfg, '--extendedDiagnostics'],
		{ cwd: root, encoding: 'utf8' }
	)
	const text = (out.stdout ?? '') + (out.stderr ?? '')
	const num = (re: RegExp) => Number(text.match(re)?.[1]?.replace(/,/g, '') ?? NaN)
	const errors = (text.match(/error TS/g) ?? []).length
	return {
		name,
		inst: num(/Instantiations:\s+(\d+)/),
		types: num(/^Types:\s+(\d+)/m),
		check: text.match(/Check time:\s+([\d.]+s)/)?.[1] ?? '?',
		errors
	}
}

rmSync(tmp, { recursive: true, force: true })
mkdirSync(tmp, { recursive: true })
try {
	console.log(`\n  Type-instantiation bench — schema reuse, N=${N} routes`)
	console.log(
		`  (imports ../../../src, so each total carries the ~1.3M one-time declaration`
	)
	console.log(`   baseline; the per-route MARGINAL is what schema reuse moves.)\n`)

	// shared 0-route baseline (empty instance) — the declaration cost to subtract
	const base = measure('_baseline', head + '')
	const rows = Object.entries(fixtures).map(([name, src]) => measure(name, src))

	const marginal = (r: { inst: number }) => r.inst - base.inst
	const inlineDistinct = rows.find((r) => r.name === 'inline-distinct')!
	const inlineMarg = marginal(inlineDistinct)
	const pad = (s: string | number, n: number) => String(s).padEnd(n)

	console.log(
		`  ${pad('fixture', 18)}${pad('total inst', 14)}${pad('marginal', 12)}${pad('/route', 10)}${pad('check', 9)}vs inline`
	)
	for (const r of rows) {
		if (r.errors) {
			console.log(`  ${pad(r.name, 18)}!! ${r.errors} type errors — fixture invalid`)
			continue
		}
		const marg = marginal(r)
		const rel = Math.round((marg / inlineMarg - 1) * 100)
		console.log(
			`  ${pad(r.name, 18)}${pad(r.inst.toLocaleString(), 14)}${pad(marg.toLocaleString(), 12)}${pad(Math.round(marg / N), 10)}${pad(r.check, 9)}${r === inlineDistinct ? '—' : `${rel > 0 ? '+' : ''}${rel}%`}`
		)
	}
	console.log(
		`\n  baseline (0 routes, declaration cost): ${base.inst.toLocaleString()} inst`
	)

	// ── regression guard: reuse must beat distinct inline, no fixture may error
	const ref = rows.find((r) => r.name === 'model-ref')!
	const bad = [base, ...rows].filter((r) => r.errors)
	if (bad.length) {
		console.error(`\n  FAIL: fixtures with type errors: ${bad.map((b) => b.name).join(', ')}`)
		process.exit(1)
	}
	if (!(marginal(ref) < inlineMarg)) {
		console.error(
			`\n  FAIL: model-ref marginal (${marginal(ref)}) is not cheaper than inline-distinct (${inlineMarg}) — schema-reuse caching regressed`
		)
		process.exit(1)
	}
	const saved = Math.round(((inlineMarg - marginal(ref)) / inlineMarg) * 100)
	console.log(
		`\n  ✓ schema reuse saves ${saved}% of the per-route cost (model-ref vs inline-distinct, marginal)\n`
	)
} finally {
	rmSync(tmp, { recursive: true, force: true })
}
