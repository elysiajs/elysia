import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { resolve, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

import * as esbuild from 'esbuild'

// The core and fixtures must share the same dist Elysia instance.
const distCore = (await import(
	resolve(import.meta.dir, '../../dist/plugin/aot/core.mjs')
)) as typeof import('../../src/plugin/aot/core')
const { generateCompiledArtifacts } = distCore
const { Compiled } = (await import(
	resolve(import.meta.dir, '../../dist/compile/aot.mjs')
)) as typeof import('../../src/compile/aot')

const { Elysia } = (await import('elysia')) as typeof import('../../src')

// Validator dependencies determine whether a build is sealed or wired.
const SEALED_APP = resolve(import.meta.dir, 'fixtures/sealed-app.ts')
const WIRED_APP = resolve(import.meta.dir, 'fixtures/wired-app.ts')
const MERGE_SCHEMA_APP = resolve(import.meta.dir, 'fixtures/mode-guard-app.ts')
const MACRO_SCHEMA_APP = resolve(import.meta.dir, 'fixtures/mode-macro-app.ts')
const LATE_ROUTE_APP = resolve(import.meta.dir, 'fixtures/mode-late-app.ts')
const EMPTY_APP = resolve(import.meta.dir, 'fixtures/mode-empty-app.ts')
const TYPEBOX_NORMALIZE_APP = resolve(
	import.meta.dir,
	'fixtures/mode-normalize-app.ts'
)
const STANDARD_SCHEMA_APP = resolve(
	import.meta.dir,
	'fixtures/mode-standard-app.ts'
)
const MIXED_SCHEMA_APP = resolve(import.meta.dir, 'fixtures/mode-mixed-app.ts')
const STANDARD_MERGE_APP = resolve(
	import.meta.dir,
	'fixtures/mode-standard-merge-app.ts'
)
const MIXED_MERGE_APP = resolve(
	import.meta.dir,
	'fixtures/mode-mixed-merge-app.ts'
)
const MERGE_MIXED_RESPONSE_APP = resolve(
	import.meta.dir,
	'fixtures/mode-merge-mixed-response-app.ts'
)
const PLAIN_MIXED_RESPONSE_APP = resolve(
	import.meta.dir,
	'fixtures/mode-plain-mixed-response-e2e-app.ts'
)
const MAP_DERIVE_APP = resolve(
	import.meta.dir,
	'fixtures/mode-map-derive-app.ts'
)
const FILE_SCHEMA_APP = resolve(import.meta.dir, 'fixtures/mode-file-app.ts')

async function buildEsbuild(app: string): Promise<string> {
	const { aot } = await import('elysia/plugin/aot/esbuild')

	const previous = process.env.ELYSIA_AOT_BUILD
	process.env.ELYSIA_AOT_BUILD = '1'
	try {
		const result = await esbuild.build({
			entryPoints: [app],
			bundle: true,
			write: false,
			format: 'esm',
			platform: 'neutral',
			minify: true,
			external: ['node:*'],
			logLevel: 'silent',
			// Preserve validation details asserted below.
			plugins: [aot(app, { production: false })]
		})
		return result.outputFiles[0]!.text
	} finally {
		if (previous === undefined) delete process.env.ELYSIA_AOT_BUILD
		else process.env.ELYSIA_AOT_BUILD = previous
	}
}

async function buildBun(app: string): Promise<string> {
	const { aot } = await import('elysia/plugin/aot/bun')

	const previous = process.env.ELYSIA_AOT_BUILD
	process.env.ELYSIA_AOT_BUILD = '1'
	try {
		const result = await Bun.build({
			entrypoints: [app],
			target: 'bun',
			minify: true,
			// Preserve validation details asserted below.
			plugins: [aot(app, { production: false })]
		})
		if (!result.success) throw new AggregateError(result.logs)
		return result.outputs[0]!.text()
	} finally {
		if (previous === undefined) delete process.env.ELYSIA_AOT_BUILD
		else process.env.ELYSIA_AOT_BUILD = previous
	}
}

let dir: string
const code: Record<string, string> = {}
const appPath: Record<string, string> = {}

beforeAll(async () => {
	dir = mkdtempSync(join(tmpdir(), 'ely-mode-gating-'))

	code.esbuildSealed = await buildEsbuild(SEALED_APP)
	code.esbuildWired = await buildEsbuild(WIRED_APP)
	code.bunWired = await buildBun(WIRED_APP)
	code.esbuildGuard = await buildEsbuild(MERGE_SCHEMA_APP)
	code.esbuildMacro = await buildEsbuild(MACRO_SCHEMA_APP)
	code.esbuildLate = await buildEsbuild(LATE_ROUTE_APP)
	code.esbuildNormalize = await buildEsbuild(TYPEBOX_NORMALIZE_APP)
	code.esbuildStandard = await buildEsbuild(STANDARD_SCHEMA_APP)
	code.esbuildMixed = await buildEsbuild(MIXED_SCHEMA_APP)
	code.esbuildStandardMerge = await buildEsbuild(STANDARD_MERGE_APP)
	code.esbuildPlainMixedResponse = await buildEsbuild(
		PLAIN_MIXED_RESPONSE_APP
	)
	code.esbuildMapDerive = await buildEsbuild(MAP_DERIVE_APP)
	code.esbuildFile = await buildEsbuild(FILE_SCHEMA_APP)

	// A live esbuild service can interfere with importing freshly written bundles.
	await esbuild.stop()

	for (const label of Object.keys(code)) {
		const file = join(dir, `${label}.mjs`)
		writeFileSync(file, code[label]!)
		appPath[label] = file
	}
})

afterAll(() => {
	if (dir) rmSync(dir, { recursive: true, force: true })
})

async function loadApp(label: string) {
	const mod = (await import(appPath[label]!)) as {
		app?: any
		default?: any
	}
	return mod.app ?? mod.default
}

// TypeBox codec/value engine markers remain only in wired output.
const dragsTypeBox = (source: string) => /typebox\/(value|compile)/.test(source)

describe('AOT mode selection', () => {
	it('picks mode=sealed when every validator is bridge-free', async () => {
		const { mode, stub } = await generateCompiledArtifacts(SEALED_APP)

		expect(mode).toBe('sealed')
		expect(stub.compat).toBe(true)
		expect(stub.bridge).toBe(false)
	})

	it('selects wired mode when a union validator requires TypeBox', async () => {
		const { mode, stub } = await generateCompiledArtifacts(WIRED_APP)

		expect(mode).toBe('wired')
		expect(stub.compat).toBe(true)
		expect(stub.bridge).toBe(true)
	})
})

/** Seal eligibility must match the runtime reconstruction limits. */
describe('AOT seal eligibility', () => {
	it('keeps merge guard schemas wired', async () => {
		const { mode, stub } = await generateCompiledArtifacts(MERGE_SCHEMA_APP)
		expect(mode).toBe('wired')
		expect(stub.compat).toBe(true)
		expect(stub.bridge).toBe(true)
	})

	it('keeps macro-injected schemas wired', async () => {
		const { mode, stub } = await generateCompiledArtifacts(MACRO_SCHEMA_APP)
		expect(mode).toBe('wired')
		expect(stub.bridge).toBe(true)
	})

	it('enforces merge schemas in wired bundles', async () => {
		expect(/setupTypebox\(\)/.test(code.esbuildGuard!)).toBe(false)

		const dir2 = mkdtempSync(join(tmpdir(), 'ely-guard-'))
		const file = join(dir2, 'guard.mjs')
		writeFileSync(file, code.esbuildGuard!)
		const mod = (await import(file)) as { app?: any; default?: any }
		const app = mod.app ?? mod.default

		const valid = await app.handle(
			new Request('http://localhost/u', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'a', age: 5 })
			})
		)
		expect(valid.status).toBe(200)
		await expect(valid.json()).resolves.toEqual({ name: 'a', age: 5 })

		const invalid = await app.handle(
			new Request('http://localhost/u', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ age: 'x' })
			})
		)
		expect(invalid.status).toBe(422)

		rmSync(dir2, { recursive: true, force: true })
	})

	it('enforces macro schemas in wired bundles', async () => {
		const dir2 = mkdtempSync(join(tmpdir(), 'ely-macro-'))
		const file = join(dir2, 'macro.mjs')
		writeFileSync(file, code.esbuildMacro!)
		const mod = (await import(file)) as { app?: any; default?: any }
		const app = mod.app ?? mod.default

		const valid = await app.handle(
			new Request('http://localhost/u', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'a' })
			})
		)
		expect(valid.status).toBe(200)

		const invalid = await app.handle(
			new Request('http://localhost/u', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ age: 'x' })
			})
		)
		expect(invalid.status).toBe(422)

		rmSync(dir2, { recursive: true, force: true })
	})

	it('keeps a routeless app wired', async () => {
		const { mode } = await generateCompiledArtifacts(EMPTY_APP)
		expect(mode).not.toBe('sealed')
		expect(mode).toBe('wired')
	})

	it('keeps normalize:"typebox" apps wired', async () => {
		const { mode, stub } = await generateCompiledArtifacts(
			TYPEBOX_NORMALIZE_APP
		)
		expect(mode).not.toBe('sealed')
		expect(mode).toBe('wired')
		expect(stub.compat).toBe(true)
		expect(stub.bridge).toBe(true)
	})

	it('keeps an app wired when capture finishes before a delayed route registers', async () => {
		const { mode } = await generateCompiledArtifacts(LATE_ROUTE_APP)
		expect(mode).not.toBe('sealed')
		expect(mode).toBe('wired')
	})

	it('rejects route registration after an app is sealed', () => {
		// Earlier artifact generation leaves a shared dist manifest registered.
		Compiled.clear()
		try {
			const sealed = new Elysia().get('/a', () => 'a')
			sealed.compile()
			const generation = (sealed as any)['~generation']
			const routesBefore = (sealed as any)['~routes'].length
			expect(() => sealed.get('/late', () => 'late')).toThrow(
				'after the app was sealed'
			)
			expect((sealed as any)['~generation']).toBe(generation)
			expect((sealed as any)['~routes'].length).toBe(routesBefore)
		} finally {
			Compiled.clear()
		}
	})

	it('reports a stripped handler compiler when a delayed route runs in a bundle', async () => {
		const dir2 = mkdtempSync(join(tmpdir(), 'ely-late-'))
		const file = join(dir2, 'late.mjs')
		writeFileSync(file, code.esbuildLate!)
		const mod = (await import(file)) as { app?: any; default?: any }
		const app = mod.app ?? mod.default
		await new Promise((r) => setTimeout(r, 10))

		const res = await app.handle(new Request('http://localhost/late'))
		expect(res.status).toBe(500)
		const body = (await res.json()) as { detail?: string }
		expect(body.detail).toContain('handler compiler JIT was stripped')
		expect(body.detail).not.toContain('Typebox module')

		rmSync(dir2, { recursive: true, force: true })
	})
})

/** Standard Schema validation does not require the TypeBox bridge. */
describe('AOT sealing with Standard Schema', () => {
	it('a pure Standard Schema app seals without TypeBox coverage', async () => {
		const { mode, stub } =
			await generateCompiledArtifacts(STANDARD_SCHEMA_APP)
		expect(mode).toBe('sealed')
		expect(stub.bridge).toBe(false)
	})

	it('a mixed route (frozen TypeBox query + live Standard body) seals', async () => {
		const { mode, stub } = await generateCompiledArtifacts(MIXED_SCHEMA_APP)
		expect(mode).toBe('sealed')
		expect(stub.bridge).toBe(false)
	})

	it('a merge Standard Schema app seals', async () => {
		const { mode } = await generateCompiledArtifacts(STANDARD_MERGE_APP)
		expect(mode).toBe('sealed')
	})

	it('keeps a Standard merge route wired when it also has a TypeBox slot', async () => {
		const { mode, stub } = await generateCompiledArtifacts(MIXED_MERGE_APP)
		expect(mode).toBe('wired')
		expect(stub.bridge).toBe(true)
	})

	it('validates Standard Schema without retaining TypeBox', async () => {
		expect(dragsTypeBox(code.esbuildStandard!)).toBe(false)

		const app = await loadApp('esbuildStandard')

		const valid = await app.handle(
			new Request('http://localhost/u', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'a', age: 5 })
			})
		)
		expect(valid.status).toBe(200)
		await expect(valid.json()).resolves.toEqual({ name: 'a', age: 5 })

		const invalid = await app.handle(
			new Request('http://localhost/u', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ age: 'x' })
			})
		)
		expect(invalid.status).toBe(422)
	})

	it('validates both TypeBox and Standard Schema slots in a sealed bundle', async () => {
		expect(dragsTypeBox(code.esbuildMixed!)).toBe(false)

		const app = await loadApp('esbuildMixed')

		const both = await app.handle(
			new Request('http://localhost/u?q=hi', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'a', age: 5 })
			})
		)
		expect(both.status).toBe(200)
		await expect(both.json()).resolves.toEqual({ name: 'a', age: 5 })

		const badBody = await app.handle(
			new Request('http://localhost/u?q=hi', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ age: 'x' })
			})
		)
		expect(badBody.status).toBe(422)

		const badQuery = await app.handle(
			new Request('http://localhost/u', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'a', age: 5 })
			})
		)
		expect(badQuery.status).toBe(422)
	})

	it('enforces a merge Standard Schema in a sealed bundle', async () => {
		expect(dragsTypeBox(code.esbuildStandardMerge!)).toBe(false)

		const app = await loadApp('esbuildStandardMerge')

		const valid = await app.handle(
			new Request('http://localhost/u', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'a', age: 5 })
			})
		)
		expect(valid.status).toBe(200)

		const invalid = await app.handle(
			new Request('http://localhost/u', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ age: 'x' })
			})
		)
		expect(invalid.status).toBe(422)
	})
})

/** Mixed Standard Schema and TypeBox response maps follow route seal eligibility. */
describe('AOT sealing with mixed response schemas', () => {
	it('keeps a merge route with a mixed response map wired', async () => {
		const { mode, stub } = await generateCompiledArtifacts(
			MERGE_MIXED_RESPONSE_APP
		)
		expect(mode).toBe('wired')
		expect(stub.bridge).toBe(true)
	})

	it('seals a plain route with a mixed response map', async () => {
		const { mode, stub } = await generateCompiledArtifacts(
			PLAIN_MIXED_RESPONSE_APP
		)
		expect(mode).toBe('sealed')
		expect(stub.bridge).toBe(false)
	})

	it('validates the TypeBox response slot after TypeBox is removed', async () => {
		expect(dragsTypeBox(code.esbuildPlainMixedResponse!)).toBe(false)

		const app = await loadApp('esbuildPlainMixedResponse')

		const ok = await app.handle(
			new Request('http://localhost/u', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'a', age: 5 })
			})
		)
		expect(ok.status).toBe(200)
		await expect(ok.json()).resolves.toEqual({ name: 'a', age: 5 })

		const badResponse = await app.handle(
			new Request('http://localhost/u?bad=1', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'a', age: 5 })
			})
		)
		expect(badResponse.status).toBe(422)
	})
})

describe('sealed esbuild output', () => {
	it('drops TypeBox and stubs setupTypebox', () => {
		expect(dragsTypeBox(code.esbuildSealed!)).toBe(false)
		expect(/setupTypebox\(\)/.test(code.esbuildSealed!)).toBe(false)
	})

	it('stays below the sealed bundle size ceiling', () => {
		const min = Buffer.byteLength(code.esbuildSealed!)
		const gz = gzipSync(code.esbuildSealed!, { level: 9 }).length
		// This ceiling distinguishes sealed output from the wired ~275K bundle.
		expect(min).toBeLessThan(160_000)
		expect(gz).toBeLessThan(50_000)
	})

	it('validates requests after sealing', async () => {
		const app = await loadApp('esbuildSealed')

		expect(
			(await app.handle(new Request('http://localhost/'))).status
		).toBe(200)

		const valid = await app.handle(
			new Request('http://localhost/u', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'a', age: 5 })
			})
		)
		expect(valid.status).toBe(200)
		await expect(valid.json()).resolves.toEqual({ name: 'a', age: 5 })

		const invalid = await app.handle(
			new Request('http://localhost/u', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ age: 'x' })
			})
		)
		// fail-closed 422 even though TypeBox `Errors` is severed
		expect(invalid.status).toBe(422)
	})
})

describe('wired esbuild output', () => {
	it('stubs setupTypebox and statically wires the mirror', () => {
		expect(/setupTypebox\(\)/.test(code.esbuildWired!)).toBe(false)
		expect(/unionPrioritySort/.test(code.esbuildWired!)).toBe(true)
	})

	it('coerces query Numeric and validates a union body', async () => {
		const app = await loadApp('esbuildWired')

		const coerced = await app.handle(new Request('http://localhost/n?n=1'))
		expect(coerced.status).toBe(200)
		await expect(coerced.text()).resolves.toBe('1')

		expect(
			(await app.handle(new Request('http://localhost/n?n=notnum')))
				.status
		).toBe(422)

		const unionValid = await app.handle(
			new Request('http://localhost/u', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ a: 'x' })
			})
		)
		expect(unionValid.status).toBe(200)

		const unionInvalid = await app.handle(
			new Request('http://localhost/u', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ c: 1 })
			})
		)
		expect(unionInvalid.status).toBe(422)
	})
})

describe('wired Bun output', () => {
	it('stubs setupTypebox and statically wires the mirror', () => {
		expect(/setupTypebox\(\)/.test(code.bunWired!)).toBe(false)
		expect(/unionPrioritySort/.test(code.bunWired!)).toBe(true)
	})

	it('coerces query Numeric and validates a union body', async () => {
		const app = await loadApp('bunWired')

		const coerced = await app.handle(new Request('http://localhost/n?n=1'))
		expect(coerced.status).toBe(200)
		await expect(coerced.text()).resolves.toBe('1')

		const unionValid = await app.handle(
			new Request('http://localhost/u', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ b: 2 })
			})
		)
		expect(unionValid.status).toBe(200)
	})
})

describe('AOT Vite hook contract', () => {
	const COMPAT = resolve(import.meta.dir, '../../src/type/compat.ts')
	const BRIDGE = resolve(import.meta.dir, '../../src/type/bridge.ts')

	it('sealed builds serve virtual types without rerouting the bridge', async () => {
		const { aot } = await import('../../src/plugin/aot/vite')
		const plugin = aot(
			resolve(import.meta.dir, 'fixtures/sealed-vite-app.ts')
		)
		await plugin.buildStart()

		const vid = plugin.resolveId('elysia/type')
		expect(vid).toBe('\0elysia/type')
		const vt = plugin.load(vid!)!
		expect(/setupTypebox/.test(vt)).toBe(false)
		expect(
			vt.split('\n').filter((l) => l.startsWith('export')).length
		).toBe(28)

		await expect(plugin.transform('x', COMPAT)).resolves.toBe(
			'export function setupTypebox(){}\n'
		)
		await expect(plugin.transform('x', BRIDGE)).resolves.toBeUndefined()
	})

	it('wired builds serve virtual types and reroute the bridge', async () => {
		const { aot } = await import('../../src/plugin/aot/vite')
		const plugin = aot(
			resolve(import.meta.dir, 'fixtures/wired-vite-app.ts')
		)
		await plugin.buildStart()

		expect(plugin.resolveId('elysia/type')).toBe('\0elysia/type')

		await expect(plugin.transform('x', COMPAT)).resolves.toBe(
			'export function setupTypebox(){}\n'
		)
		await expect(plugin.transform('x', BRIDGE)).resolves.toBe(
			"export * from './bridge-live'\n"
		)
	})
})

describe('AOT mapDerive bundling', () => {
	it('selects sealed mode when the app has handlers but no validators', async () => {
		const { mode } = await generateCompiledArtifacts(MAP_DERIVE_APP)
		expect(mode).toBe('sealed')
	})

	it('preserves mapDerive results through the bundle', async () => {
		const app = await loadApp('esbuildMapDerive')

		const res = await app.handle(new Request('http://localhost/'))
		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ mapped: 'from-map-derive' })
	})
})

describe('AOT t.File seal eligibility', () => {
	it('keeps t.File body schemas wired', async () => {
		const { mode, stub } = await generateCompiledArtifacts(FILE_SCHEMA_APP)
		expect(mode).toBe('wired')
		expect(stub.compat).toBe(true)
		expect(stub.bridge).toBe(true)
	})

	it('rejects a missing file in the wired bundle', async () => {
		const app = await loadApp('esbuildFile')

		const invalid = await app.handle(
			new Request('http://localhost/upload', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ notAFile: true })
			})
		)
		expect(invalid.status).toBe(422)
	})
})
