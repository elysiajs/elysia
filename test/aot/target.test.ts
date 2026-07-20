import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { resolve } from 'node:path'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import {
	captureImpl,
	Compiled,
	setCaptureImpl
} from '../../src/compile/aot'
import {
	endValidatorCapture,
	endHandlerCapture,
	getCompilerSessionDiagnostics
} from '../../src/compile/aot-capture'
import { compileToSource } from '../../src/plugin/aot/source'
import {
	countTypeBoxValidatorSlots,
	generateCompiledArtifacts
} from '../../src/plugin/aot/core'

/** The AOT target selects the runtime-specific header extraction it emits. */
const build = () =>
	new Elysia()
		.beforeHandle(() => {})
		.get(
			'/',
			{ headers: t.Object({ 'x-id': t.Optional(t.String()) }) },
			({ headers }) => headers['x-id'] ?? 'ok'
		)

const TOJSON = 'c.request.headers.toJSON()'
const FROM_ENTRIES = 'Object.fromEntries(c.request.headers)'
const RESPONSE_MAP_APP = resolve(
	import.meta.dir,
	'fixtures/workerd-response-map-app.ts'
)
const DUPLICATE_ROUTE_APP = resolve(
	import.meta.dir,
	'fixtures/workerd-duplicate-route-app.ts'
)
const STANDARD_MODEL_APP = resolve(
	import.meta.dir,
	'fixtures/workerd-standard-model-app.ts'
)
const STANDARD_STANDALONE_MODEL_APP = resolve(
	import.meta.dir,
	'fixtures/workerd-standard-standalone-model-app.ts'
)
const STANDARD_STANDALONE_RESPONSE_APP = resolve(
	import.meta.dir,
	'fixtures/workerd-standard-standalone-response-app.ts'
)
const EAGER_COMPILE_APP = resolve(
	import.meta.dir,
	'fixtures/workerd-eager-compile-app.ts'
)
const MISMATCH_APP = resolve(
	import.meta.dir,
	'fixtures/workerd-mismatch-app.ts'
)
const SHIFTED_APP = resolve(
	import.meta.dir,
	'fixtures/workerd-shifted-app.ts'
)
const WIRED_APP = resolve(import.meta.dir, 'fixtures/wired-vite-app.ts')

beforeEach(() => {
	process.env.ELYSIA_AOT_BUILD = '1'
	endValidatorCapture()
	endHandlerCapture()
})
afterEach(() => {
	delete process.env.ELYSIA_AOT_BUILD
	Compiled.clear()
	Validator.clear()
})

describe('AOT target-specific header extraction', () => {
	it('counts TypeBox request and response slots for one canonical route', () => {
		expect(
			countTypeBoxValidatorSlots({
				body: t.Object({ value: t.String() }),
				response: {
					200: t.Object({ ok: t.Boolean() }),
					404: t.Object({ error: t.String() })
				}
			})
		).toBe(3)
	})

	it('counts only the last duplicate route when checking workerd coverage', async () => {
		const { mode, source } = await generateCompiledArtifacts(
			DUPLICATE_ROUTE_APP,
			{ target: 'workerd' }
		)

		expect(mode).toBe('sealed')
		expect(source).toContain('"winner" in value')
		expect(source).not.toContain('"stale" in value')
	})

	it('resolves Standard Schema model refs before checking workerd coverage', async () => {
		const { mode, stub } = await generateCompiledArtifacts(STANDARD_MODEL_APP, {
			target: 'workerd'
		})

		expect(mode).toBe('sealed')
		expect(stub.bridge).toBe(false)
	})

	it('resolves standalone Standard Schema model refs for workerd', async () => {
		const { mode, stub } = await generateCompiledArtifacts(
			STANDARD_STANDALONE_MODEL_APP,
			{ target: 'workerd' }
		)

		expect(mode).toBe('sealed')
		expect(stub.bridge).toBe(false)
	})

	it('recognizes standalone Standard Schema response maps for workerd', async () => {
		const { mode, stub } = await generateCompiledArtifacts(
			STANDARD_STANDALONE_RESPONSE_APP,
			{ target: 'workerd' }
		)

		expect(mode).toBe('sealed')
		expect(stub.bridge).toBe(false)
	})

	it('throws when workerd capture does not exactly cover validator slots', async () => {
		const saved = captureImpl!
		setCaptureImpl({
			...saved,
			maybeCapture() {},
			captureMirror() {},
			captureCodecMirror() {},
			captureBridgeFree() {}
		})

		try {
			await expect(
				generateCompiledArtifacts(MISMATCH_APP, { target: 'workerd' })
			).rejects.toThrow('captured 0 validator slots but expected 1')
		} finally {
			setCaptureImpl(saved)
		}
	})

	it('rejects equal slot counts captured for the wrong route', async () => {
		const saved = captureImpl!
		let shiftedCalls = 0
		const wrongPath = (aot: { method: string; path: string }) => {
			shiftedCalls++
			return { ...aot, path: '/wrong' }
		}
		setCaptureImpl({
			...saved,
			maybeCapture(args) {
				saved.maybeCapture({ ...args, aot: wrongPath(args.aot) })
			},
			captureMirror(schema, aot, slot, sanitize) {
				saved.captureMirror(
					schema,
					wrongPath(aot),
					slot,
					sanitize
				)
			},
			captureCodecMirror(schema, aot, slot, sanitize, direction) {
				saved.captureCodecMirror(
					schema,
					wrongPath(aot),
					slot,
					sanitize,
					direction
				)
			},
			captureBridgeFree(aot, slot, rawSchema) {
				saved.captureBridgeFree(
					wrongPath(aot),
					slot,
					rawSchema
				)
			}
		})

		try {
			let thrown: unknown
			try {
				await generateCompiledArtifacts(SHIFTED_APP, {
					target: 'workerd'
				})
			} catch (error) {
				thrown = error
			}

			expect(shiftedCalls).toBeGreaterThan(0)
			expect(String(thrown)).toContain(
				'Missing: POST /shifted (body). Unexpected: POST /wrong (body).'
			)
		} finally {
			setCaptureImpl(saved)
		}
	})

	it('rejects a fully captured workerd manifest that still needs TypeBox', async () => {
		await expect(
			generateCompiledArtifacts(WIRED_APP, { target: 'workerd' })
		).rejects.toThrow(
			"requires a sealed AOT manifest, but validator reconstruction selected mode 'wired'"
		)
	})

	it('rejects workerd strip:false before importing or capturing', async () => {
		const importCounter = Symbol.for('elysia.test.workerd-eager-imports')
		delete (globalThis as any)[importCounter]

		await expect(
			generateCompiledArtifacts(EAGER_COMPILE_APP, {
				target: 'workerd',
				strip: false
			})
		).rejects.toThrow(
			'cannot disable AOT stripping because runtime handler and validator compilation is unavailable on workerd'
		)

		expect((globalThis as any)[importCounter]).toBeUndefined()
		expect(getCompilerSessionDiagnostics().active).toBe(false)

		const { source } = await generateCompiledArtifacts(RESPONSE_MAP_APP, {
			target: 'workerd'
		})
		expect(source).not.toContain('/eager-leak')
	})

	it('distinguishes one TypeBox response from a multi-status response map', async () => {
		await expect(
			generateCompiledArtifacts(RESPONSE_MAP_APP, { target: 'workerd' })
		).resolves.toBeDefined()
	})

	it("emits Object.fromEntries for target: 'workerd' even when built on Bun", async () => {
		const src = await compileToSource(build() as any, {
			register: false,
			target: 'workerd'
		})

		expect(src).toInclude(FROM_ENTRIES)
		expect(src).not.toInclude(TOJSON)
	})

	it("emits Object.fromEntries for target: 'node'", async () => {
		const src = await compileToSource(build() as any, {
			register: false,
			target: 'node'
		})

		expect(src).toInclude(FROM_ENTRIES)
		expect(src).not.toInclude(TOJSON)
	})

	it("emits Headers.toJSON for target: 'bun'", async () => {
		const src = await compileToSource(build() as any, {
			register: false,
			target: 'bun'
		})

		expect(src).toInclude(TOJSON)
		expect(src).not.toInclude(FROM_ENTRIES)
	})
})
