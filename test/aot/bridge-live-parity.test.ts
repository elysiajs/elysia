import { describe, it, expect } from 'bun:test'

/** The statically wired bridge must match a bridge initialized at runtime. */
describe('statically wired TypeBox bridge', () => {
	const MEMBERS = [
		'applyCoercions',
		'TypeBoxValidator',
		'TypeBoxValidatorCache',
		'coerceFormData',
		'coerceQuery',
		'coerceRoot',
		'coerceStringToStructure',
		'coerceBody',
		'hasTypes',
		'Intersect'
	] as const

	// Deferred through `type/typebox-value`: the runtime bridge is wired at import
	// time, so it holds the pre-load stubs and cannot be identity-compared.
	// `typebox-value` is the seam the stubs resolve to, so the mirror must match
	// THAT, otherwise a statically wired build calls a different function
	const DEFERRED = ['Compile', 'Decode', 'HasCodec', 'Default', 'Clone'] as const

	// Same, one seam over: `Ref` is a `typebox/type` builder, deferred behind
	// the separate `typebox-type` latch
	const DEFERRED_TYPE = ['Ref'] as const

	it('matches every runtime export from an initialized bridge', async () => {
		const { setupTypebox } = await import('../../src/type/compat')
		setupTypebox()

		const bridge = (await import('../../src/type/bridge')) as Record<
			string,
			unknown
		>
		const live = (await import('../../src/type/bridge-live')) as Record<
			string,
			unknown
		>

		for (const member of MEMBERS) {
			expect(live[member]).toBe(bridge[member])
			expect(live[member]).toBeDefined()
		}

		const ops = (await import('../../src/type/typebox-value')) as Record<
			string,
			any
		>

		// force the lazy load so the seam holds the real ops
		ops.HasCodec({ type: 'string' })

		for (const member of DEFERRED) {
			expect(live[member]).toBe(ops[member])
			expect(typeof bridge[member]).toBe('function')
		}

		const typeOps = (await import(
			'../../src/type/typebox-type'
		)) as Record<string, any>

		// force the lazy load so the seam holds the real builders
		typeOps.Ref('#/x')

		for (const member of DEFERRED_TYPE) {
			expect(live[member]).toBe(typeOps[member])
			expect(typeof bridge[member]).toBe('function')
		}
	})

	it('exports isBridgeLive from both modules, true once wired', async () => {
		const { setupTypebox } = await import('../../src/type/compat')
		setupTypebox()

		const bridge = (await import('../../src/type/bridge')) as Record<
			string,
			any
		>
		const live = (await import('../../src/type/bridge-live')) as Record<
			string,
			any
		>

		expect(typeof bridge.isBridgeLive).toBe('function')
		expect(typeof live.isBridgeLive).toBe('function')
		expect(bridge.isBridgeLive()).toBe(true)
		expect(live.isBridgeLive()).toBe(true)
	})

	// The live bridge already loaded TypeBox, so warming it is a no-op.
	it('exports warmTypebox from both modules, inert in the mirror', async () => {
		const { setupTypebox } = await import('../../src/type/compat')
		setupTypebox()

		const bridge = (await import('../../src/type/bridge')) as Record<
			string,
			any
		>
		const live = (await import('../../src/type/bridge-live')) as Record<
			string,
			any
		>

		expect(typeof bridge.warmTypebox).toBe('function')
		expect(typeof live.warmTypebox).toBe('function')

		const before = live.Compile
		expect(live.warmTypebox()).toBeUndefined()
		expect(live.Compile).toBe(before)
	})

	it('keeps useTypebox idempotent', async () => {
		const { setupTypebox } = await import('../../src/type/compat')
		setupTypebox()

		const live = (await import('../../src/type/bridge-live')) as Record<
			string,
			any
		>

		expect(typeof live.useTypebox).toBe('function')

		const before = live.Compile
		live.useTypebox({})
		expect(live.Compile).toBe(before)
	})

	it('imports the runtime bridge module successfully', async () => {
		await expect(
			import('../../src/type/bridge-live')
		).resolves.toBeDefined()
	})
})
