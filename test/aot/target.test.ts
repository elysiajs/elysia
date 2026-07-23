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
	getCompilerSessionDiagnostics
} from '../../src/compile/aot-capture'
import { compileToSource } from '../../src/plugin/aot/source'
import {
	countTypeBoxValidatorSlots,
	generateCompiledArtifacts,
	generateCompiledArtifactsIsolated
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
		const { source } = await generateCompiledArtifacts(
			DUPLICATE_ROUTE_APP,
			{ target: 'workerd' }
		)

		expect(source).toContain('"winner" in value')
		expect(source).not.toContain('"stale" in value')
	})

	it('resolves Standard Schema model refs before checking workerd coverage', async () => {
		await expect(
			generateCompiledArtifacts(STANDARD_MODEL_APP, {
				target: 'workerd'
			})
		).resolves.toHaveProperty('source')
	})

	it('resolves standalone Standard Schema model refs for workerd', async () => {
		await expect(
			generateCompiledArtifacts(STANDARD_STANDALONE_MODEL_APP, {
				target: 'workerd'
			})
		).resolves.toHaveProperty('source')
	})

	it('recognizes standalone Standard Schema response maps for workerd', async () => {
		await expect(
			generateCompiledArtifacts(STANDARD_STANDALONE_RESPONSE_APP, {
				target: 'workerd'
			})
		).resolves.toHaveProperty('source')
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
			expect(String(thrown)).toContain('Validator image layout mismatch')
		} finally {
			setCaptureImpl(saved)
		}
	})

	it('rejects a fully captured workerd manifest that still needs TypeBox', async () => {
		await expect(
			generateCompiledArtifacts(WIRED_APP, { target: 'workerd' })
		).rejects.toThrow(
			'requires every TypeBox validator to have a complete bridge-free AppPlan image'
		)
	})

	it('rejects every removed strip value before importing or spawning', async () => {
		const importCounter = Symbol.for('elysia.test.workerd-eager-imports')
		delete (globalThis as any)[importCounter]
		const error =
			'[elysia-aot] option "strip" was removed; AOT always emits one complete AppPlan image.'

		for (const strip of [false, true, 'auto'] as const)
			await expect(
				generateCompiledArtifacts(EAGER_COMPILE_APP, {
					strip
				} as any)
			).rejects.toThrow(error)

		await expect(
			generateCompiledArtifactsIsolated(EAGER_COMPILE_APP, {
				strip: false
			} as any)
		).rejects.toThrow(error)

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

	it("records web-standard adapter identity for target: 'workerd'", async () => {
		const src = await compileToSource(build() as any, {
			register: false,
			target: 'workerd'
		})

		expect(src).toInclude('"adapter":{"target":"web-standard"')
		expect(src).not.toMatch(/export const handlers|const _h\d+/)
	})

	it("records web-standard adapter identity for target: 'node'", async () => {
		const src = await compileToSource(build() as any, {
			register: false,
			target: 'node'
		})

		expect(src).toInclude('"adapter":{"target":"web-standard"')
		expect(src).not.toMatch(/export const handlers|const _h\d+/)
	})

	it("records Bun adapter identity for target: 'bun'", async () => {
		const src = await compileToSource(build() as any, {
			register: false,
			target: 'bun'
		})

		expect(src).toInclude('"adapter":{"target":"bun"')
		expect(src).not.toMatch(/export const handlers|const _h\d+/)
	})
})
