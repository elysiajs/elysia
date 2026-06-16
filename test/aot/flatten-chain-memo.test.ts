import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'
import { req } from '../utils'

/**
 * flattenChain memo harness (F16).
 *
 * `compileHandler` re-flattens the same shared chain head once per route. F16
 * memoizes the no-keep/no-stopAt flatten ROOT-SCOPED, handing out a fresh clone
 * each call (consumers mutate the result). The hazard is macro staleness: macro
 * resolution mutates `node.added` in place per-root, so a node-keyed (not
 * root-keyed) cache could leak a macro-less root's un-expanded result into a
 * macro root. The root-scoped cache + clone-on-return must keep every
 * composition behaviour identical regardless of compile order.
 */

describe('F16: shared chain head, many routes', () => {
	it('app-level hooks apply identically across all routes (shared head)', async () => {
		const order: string[] = []
		const app = new Elysia()
			.beforeHandle(() => {
				order.push('before')
			})
			.get('/a', () => 'a')
			.get('/b', () => 'b')
			.get('/c', () => 'c')

		expect(await (await app.handle(req('/a'))).text()).toBe('a')
		expect(await (await app.handle(req('/b'))).text()).toBe('b')
		expect(await (await app.handle(req('/c'))).text()).toBe('c')
		// beforeHandle ran once per request, for every route
		expect(order).toEqual(['before', 'before', 'before'])
	})

	it('derive on the shared head reaches every route', async () => {
		const app = new Elysia()
			.derive(() => ({ shared: 'x' }))
			.get('/a', (c: any) => c.shared)
			.get('/b', (c: any) => c.shared)

		expect(await (await app.handle(req('/a'))).text()).toBe('x')
		expect(await (await app.handle(req('/b'))).text()).toBe('x')
	})
})

describe('F16: cross-root macro staleness', () => {
	// One plugin instance, two consumer apps; only one consumer registers a route
	// that triggers a macro. Compile the macro-LESS app first (worst case for a
	// naive node-keyed cache), then assert the macro app still runs its macro
	// hook. The root-scoped cache must isolate the two roots' views of any shared
	// chain node.
	it('macro-less app compiled first does not strip the macro app of hooks', async () => {
		let macroRan = 0

		// Shared plugin instance with an app-level hook chain (so a chain head is
		// snapshotted and shared into both consumers).
		const plugin = new Elysia({ name: 'shared-plugin' })
			.beforeHandle(() => {})
			.get('/plug', () => 'plug')

		const macroLess = new Elysia().use(plugin).get('/a', () => 'a')

		const withMacro = new Elysia()
			.use(plugin)
			.macro({
				audit(enabled: boolean) {
					return {
						beforeHandle() {
							if (enabled) macroRan++
						}
					}
				}
			})
			.get('/b', () => 'b', { audit: true } as any)

		// compile the macro-less app FIRST
		;(macroLess as any).compile()
		;(withMacro as any).compile()

		// macro-less app still serves
		expect(await (await macroLess.handle(req('/a'))).text()).toBe('a')
		expect(await (await macroLess.handle(req('/plug'))).text()).toBe('plug')

		// macro app's macro hook still fires
		const res = await withMacro.handle(req('/b'))
		expect(await res.text()).toBe('b')
		expect(macroRan).toBe(1)
	})

	// Reverse order: macro app compiled first, then macro-less. The macro-less
	// app must NOT inherit the macro app's expanded hooks.
	it('macro app compiled first does not leak macro hooks into the macro-less app', async () => {
		let macroRan = 0

		const plugin = new Elysia({ name: 'shared-plugin-2' })
			.beforeHandle(() => {})
			.get('/plug', () => 'plug')

		const withMacro = new Elysia()
			.use(plugin)
			.macro({
				audit(enabled: boolean) {
					return {
						beforeHandle() {
							if (enabled) macroRan++
						}
					}
				}
			})
			.get('/b', () => 'b', { audit: true } as any)

		const macroLess = new Elysia().use(plugin).get('/a', () => 'a')

		;(withMacro as any).compile()
		;(macroLess as any).compile()

		expect(await (await macroLess.handle(req('/a'))).text()).toBe('a')

		// the macro hook fired exactly once (on the macro app), not twice
		const res = await withMacro.handle(req('/b'))
		expect(await res.text()).toBe('b')
		expect(macroRan).toBe(1)
	})
})

describe('F16: memo returns mutation-safe clones', () => {
	// Two apps using the same plugin must not corrupt each other's hooks via the
	// shared cache (consumers mutate the flatten result in place — promoteDerive,
	// fn→[fn], mergeHook). If the memo leaked the cached object by reference, the
	// second app would see the first app's normalized/mutated hooks.
	it('two consumers of one plugin keep independent hooks', async () => {
		const plugin = new Elysia({ name: 'p3' })
			.beforeHandle(() => {})
			.get('/p', () => 'p')

		const a = new Elysia()
			.use(plugin)
			.afterHandle(({ responseValue }) => `${responseValue}-A`)
			.get('/x', () => 'x')

		const b = new Elysia()
			.use(plugin)
			.afterHandle(({ responseValue }) => `${responseValue}-B`)
			.get('/y', () => 'y')

		// interleave compiles
		;(a as any).compile()
		;(b as any).compile()

		// Each consumer's own afterHandle stays its own — the shared-plugin flatten
		// cache must not leak A's normalized hooks into B (or vice versa).
		expect(await (await a.handle(req('/x'))).text()).toBe('x-A')
		expect(await (await b.handle(req('/y'))).text()).toBe('y-B')
		// the shared plugin route still serves in both consumers
		expect((await a.handle(req('/p'))).status).toBe(200)
		expect((await b.handle(req('/p'))).status).toBe(200)
	})
})
