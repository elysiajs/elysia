import { describe, it, expect } from 'bun:test'

/** The statically wired bridge must match a bridge initialized at runtime. */
describe('statically wired TypeBox bridge', () => {
	const MEMBERS = [
		'Compile',
		'Decode',
		'applyCoercions',
		'TypeBoxValidator',
		'TypeBoxValidatorCache',
		'coerceFormData',
		'coerceQuery',
		'coerceRoot',
		'coerceStringToStructure',
		'coerceBody',
		'hasTypes',
		'HasCodec',
		'Intersect',
		'Default',
		'Ref',
		'Clone'
	] as const

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
		expect(bridge.isTypeboxInitialized()).toBe(true)
		expect(live.isTypeboxInitialized()).toBe(true)
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
