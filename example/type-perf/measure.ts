// @ts-nocheck — perf harness, run under Bun (`bun run`), not in a typecheck gate.
/**
 * Type-instantiation benchmark — schema reuse.
 *
 * Compare distinct inline schemas, identical inline schemas, and one named
 * model. Counters show the cost of each app; they do not isolate compiler cache
 * internals. A zero-route app supplies the shared import/checking baseline.
 *
 *   bun run example/type-perf/measure.ts [N=50] [package|source]
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const N = Number(process.argv[2] ?? 50)
const entry = process.argv[3] ?? 'package'
if (!Number.isSafeInteger(N) || N < 1 || !['package', 'source'].includes(entry))
	throw new Error('usage: measure.ts [positive route count] [package|source]')
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..') // repo root
const tmp = join(here, '.bench-tmp')

// ── fixtures: identical handlers/route count, differ ONLY in how the body
//    schema is supplied (the variable under test) ─────────────────────────────
const imports = `import { Elysia, t } from '${entry === 'source' ? '../../../src' : 'elysia'}'\n\n`
const head = imports + `export default new Elysia()\n`
const route = (i: number, schema: string, field = 'a') =>
	`  .post('/r${i}/:id', ${schema}, ({ body, params }) => ({ id: params.id, a: body.${field} }))\n`

const fixtures: Record<string, string> = {
	// N different schema shapes.
	'inline-distinct':
		head +
		Array.from({ length: N }, (_, i) =>
			route(
				i,
				`{ body: t.Object({ a${i}: t.String(), b${i}: t.Number(), c${i}: t.Boolean() }) }`,
				`a${i}`
			)
		).join(''),
	// N separate expressions with exactly the same schema and handler shape.
	'inline-same':
		head +
		Array.from({ length: N }, (_, i) =>
			route(
				i,
				`{ body: t.Object({ a: t.String(), b: t.Number(), c: t.Boolean() }) }`
			)
		).join(''),
	// 1 registered model, N references by name.
	'model-ref':
		head +
		`  .model({ Body: t.Object({ a: t.String(), b: t.Number(), c: t.Boolean() }) })\n` +
		Array.from(
			{ length: N },
			(_, i) =>
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
		join(root, 'node_modules/.bin/tsc'),
		['--project', cfg, '--extendedDiagnostics'],
		{ cwd: root, encoding: 'utf8' }
	)
	const text = (out.stdout ?? '') + (out.stderr ?? '')
	if (out.error || out.status !== 0)
		throw new Error(
			`${name}: compiler failed (${out.status ?? out.signal}): ${out.error ?? ''}\n${text}`
		)
	const num = (re: RegExp) =>
		Number(text.match(re)?.[1]?.replace(/,/g, '') ?? NaN)
	const result = {
		name,
		inst: num(/Instantiations:\s+(\d+)/),
		types: num(/^Types:\s+(\d+)/m),
		check: text.match(/Check time:\s+([\d.]+s)/)?.[1]
	}
	if (
		!Number.isFinite(result.inst) ||
		!Number.isFinite(result.types) ||
		!result.check
	)
		throw new Error(`${name}: missing compiler diagnostics\n${text}`)
	return result
}

rmSync(tmp, { recursive: true, force: true })
mkdirSync(tmp, { recursive: true })
try {
	console.log(
		`\n  Type-instantiation bench — schema reuse, N=${N} routes, ${entry} imports\n`
	)

	// Shared import/checking baseline for an empty instance.
	const base = measure('_baseline', head + '')
	const rows = Object.entries(fixtures).map(([name, src]) =>
		measure(name, src)
	)

	const marginal = (r: { inst: number }) => r.inst - base.inst
	const inlineDistinct = rows.find((r) => r.name === 'inline-distinct')!
	const inlineMarg = marginal(inlineDistinct)
	const pad = (s: string | number, n: number) => String(s).padEnd(n)

	console.log(
		`  ${pad('fixture', 18)}${pad('total inst', 14)}${pad('marginal', 12)}${pad('/route', 10)}${pad('check', 9)}vs inline`
	)
	for (const r of rows) {
		const marg = marginal(r)
		const rel = Math.round((marg / inlineMarg - 1) * 100)
		console.log(
			`  ${pad(r.name, 18)}${pad(r.inst.toLocaleString(), 14)}${pad(marg.toLocaleString(), 12)}${pad(Math.round(marg / N), 10)}${pad(r.check, 9)}${r === inlineDistinct ? '—' : `${rel > 0 ? '+' : ''}${rel}%`}`
		)
	}
	console.log(
		`\n  baseline (0 routes, import/checking cost): ${base.inst.toLocaleString()} inst`
	)

	// Fixed-size guard: registration overhead may exceed savings on small apps.
	const ref = rows.find((r) => r.name === 'model-ref')!
	if (N === 50 && !(marginal(ref) < inlineMarg)) {
		console.error(
			`\n  FAIL: model-ref marginal (${marginal(ref)}) is not cheaper than inline-distinct (${inlineMarg})`
		)
		process.exit(1)
	}
	const saved = Math.round(((inlineMarg - marginal(ref)) / inlineMarg) * 100)
	console.log(
		`\n  model-ref uses ${Math.abs(saved)}% ${saved >= 0 ? 'fewer' : 'more'} marginal instantiations than inline-distinct\n`
	)
} finally {
	rmSync(tmp, { recursive: true, force: true })
}
