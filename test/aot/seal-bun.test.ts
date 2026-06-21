import { describe, it, expect, afterEach, afterAll } from 'bun:test'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import { compileToSource } from '../../src/plugin/source'
import { aot } from '../../src/plugin/bun'
import { sealStubSource } from '../../src/plugin/core'
import { unlinkSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Bun has no per-module sideEffects override, so the seal drops typebox/value+
 * compile by stubbing the dead-under-seal barrels (core.ts sealStubSource). This:
 *   1. drives the REAL src/plugin/bun.ts `aot()` plugin and proves a sealed build
 *      contains no typebox/value+compile code (an unsealed build does);
 *   2. proves a sealed app still SERVES requests correctly (coerce → 200, reject
 *      → 422), in-process via the real manifest;
 *   3. is a real drift guard — `sealStubSource` must export every runtime
 *      (non-`import type`) name Elysia imports from typebox/value + typebox/compile.
 */

const ROOT = join(import.meta.dir, '../..')
const G = globalThis as any

afterEach(() => {
	Compiled.clear()
	Validator.clear()
	G.ELY_SEALED = undefined
	delete process.env.ELYSIA_AOT_BUILD
})

// ---- 1. the real bun.ts plugin drops typebox/value+compile ------------------

// distinctive string literals from typebox/build/{value,compile} — present in an
// unsealed bundle, gone once value+compile are dropped.
const TB_MARKERS = [
	'Strings with format or pattern constraints must specify default', // value/default
	'Unable to de-reference target type', // value/clone
	'export function Check(value)' // compile/code codegen template
]
const hasTypebox = (bundle: string) => TB_MARKERS.some((m) => bundle.includes(m))

const APP = `import { Elysia, t } from '${ROOT}/src'
export default new Elysia()
	.get('/q', { query: t.Object({ n: t.Numeric() }) }, ({ query }) => query)
	.post('/b', { body: t.Object({ filter: t.ObjectString({ name: t.String(), age: t.Numeric() }) }) }, ({ body }) => body)`

const entry = join(import.meta.dir, '__seal_bun_app.ts')
await Bun.write(entry, APP)
afterAll(() => {
	try {
		unlinkSync(entry)
	} catch {}
})

// Control: a raw build (no aot plugin → the app is never executed/compiled, just
// bundled) uses JIT TypeBox, so typebox/value+compile are present.
const buildRaw = async () => {
	const r = await Bun.build({
		entrypoints: [entry],
		target: 'browser',
		minify: true
	})
	if (!r.success) throw new AggregateError(r.logs, 'raw build failed')
	return await r.outputs[0].text()
}

// The real src/plugin/bun.ts aot() plugin, sealed. registerFrom → src so the
// manifest's `Compiled` import resolves to this repo's source (not a stale `dist`).
const buildSealed = async () => {
	const r = await Bun.build({
		entrypoints: [entry],
		target: 'browser',
		minify: true,
		plugins: [aot(entry, { seal: true, registerFrom: `${ROOT}/src` })]
	})
	if (!r.success) throw new AggregateError(r.logs, 'sealed build failed')
	return await r.outputs[0].text()
}

describe('seal (Bun) — real aot() plugin drops typebox/value+compile', () => {
	it('typebox is present in a raw build and gone from the sealed aot build', async () => {
		expect(hasTypebox(await buildRaw())).toBe(true) // control — markers are real
		expect(hasTypebox(await buildSealed())).toBe(false) // sealed — fully dropped
	}, 30_000)
})

// ---- 2. a sealed app still serves requests correctly ------------------------

const evalManifest = (src: string): any =>
	new Function(
		src
			.replace('export const validators', 'const validators')
			.replace('export const handlers', 'const handlers')
			.replace('export default validators', 'return validators')
			.replace(/^import .*$/gm, '')
	)()

const sealedServe = async (make: () => any) => {
	process.env.ELYSIA_AOT_BUILD = '1'
	const src = await compileToSource(make() as any, {
		register: false,
		seal: true
	})
	delete process.env.ELYSIA_AOT_BUILD

	Compiled.clear()
	Validator.clear()
	Compiled.validators = evalManifest(src)
	G.ELY_SEALED = true

	const app: any = make()
	app.compile()
	return async (url: string) => {
		const r = await app.handle(new Request('http://localhost' + url))
		return { status: r.status, body: await r.text() }
	}
}

describe('seal — a sealed app serves requests correctly', () => {
	it('coerces valid input (200) and rejects invalid (422)', async () => {
		const hit = await sealedServe(() =>
			new Elysia().get(
				'/q',
				{ query: t.Object({ n: t.Numeric() }) },
				({ query }: any) => query
			)
		)

		const ok = await hit('/q?n=5')
		expect(ok.status).toBe(200)
		expect(JSON.parse(ok.body).n).toBe(5) // coerced string → number

		expect((await hit('/q?n=notnum')).status).toBe(422)
	})
})

// ---- 3. drift guard: stub list ⊇ every runtime typebox/value+compile import --

const runtimeImports = (src: string, mod: string): string[] => {
	const re = new RegExp(
		`import\\s+(type\\s+)?\\{([^}]*)\\}\\s+from\\s+['"]typebox/${mod}['"]`,
		'g'
	)
	const out: string[] = []
	let m: RegExpExecArray | null
	while ((m = re.exec(src))) {
		if (m[1]) continue // `import type { … }` — erased
		for (let part of m[2].split(',')) {
			part = part.trim()
			if (!part || part.startsWith('type ')) continue // inline `type X`
			const name = part.split(/\s+as\s+/)[0].trim() // original name before `as`
			if (name) out.push(name)
		}
	}
	return out
}

const stubExports = (mod: string) =>
	new Set(
		[...sealStubSource(`typebox/${mod}`).matchAll(/export const (\w+)/g)].map(
			(m) => m[1]
		)
	)

describe('seal — stub export list stays in sync with Elysia imports', () => {
	it('sealStubSource covers every runtime name Elysia imports from typebox/value+compile', () => {
		const value = new Set<string>()
		const compile = new Set<string>()

		for (const f of new Bun.Glob('src/**/*.ts').scanSync(ROOT)) {
			const src = readFileSync(join(ROOT, f), 'utf8')
			runtimeImports(src, 'value').forEach((n) => value.add(n))
			runtimeImports(src, 'compile').forEach((n) => compile.add(n))
		}

		// every name Elysia imports at runtime MUST be in the stub, or a sealed
		// Bun/Vite build fails with a missing-export error.
		expect([...value].filter((n) => !stubExports('value').has(n))).toEqual([])
		expect(
			[...compile].filter((n) => !stubExports('compile').has(n))
		).toEqual([])
		// sanity: we actually found the imports (guards against a broken scan)
		expect(value.size).toBeGreaterThan(0)
		expect(compile.has('Compile')).toBe(true)
	})
})
