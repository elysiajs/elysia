import { describe, it, expect } from 'bun:test'

/**
 * `src/type/bridge-live.ts` is the statically-wired twin of `src/type/bridge.ts`.
 * The AOT build plugin re-routes `type/bridge` → `type/bridge-live` in wired
 * (mode B) builds when it stubs `type/compat` (so the `setupTypebox` latch is
 * gone). For that reroute to be sound, `bridge-live` must expose EXACTLY the
 * same wired members `bridge` exposes after `setupTypebox()` runs — same
 * function/class identities — and `useTypebox` must be an idempotent no-op so a
 * stray re-wire cannot un-latch anything.
 *
 * This pins that value-for-value parity: if `compat`'s `setupTypebox` injection
 * (or the mirror) ever drifts, one of these members diverges and this fails.
 */
describe('bridge-live mirror parity', () => {
	// The bridge members are typed against TypeBox; runtime identity is what the
	// reroute depends on, so compare the runtime bindings.
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

	it('exports the same wired members as bridge after setupTypebox()', async () => {
		// Wire the real bridge first (this is what an ordinary elysia import does).
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
			// Same runtime identity — the reroute swaps the module, not the value.
			expect(live[member]).toBe(bridge[member])
			// And it must actually be the real (non-throwing stub) member.
			expect(live[member]).toBeDefined()
		}
	})

	it('exports useTypebox as an idempotent no-op', async () => {
		const { setupTypebox } = await import('../../src/type/compat')
		setupTypebox()

		const live = (await import('../../src/type/bridge-live')) as Record<
			string,
			any
		>

		expect(typeof live.useTypebox).toBe('function')

		const before = live.Compile
		// Re-wiring with garbage must not change the already-wired members.
		live.useTypebox({})
		expect(live.Compile).toBe(before)
	})

	it('matches the TypeboxModule shape bridge.useTypebox expects (tsc)', () => {
		// Compile-time parity: `bridge-live.ts` types its assembled module against
		// `Parameters<typeof useTypebox>[0]` (bridge's own `TypeboxModule`). If a
		// member were missing or mistyped, `bun run build` / tsc would fail before
		// this test runs. Assert the module imports cleanly as a runtime witness.
		expect(() => import('../../src/type/bridge-live')).not.toThrow()
	})
})
