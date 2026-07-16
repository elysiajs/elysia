import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'
import { req } from '../utils'

/** Flattened hook chains are cached per app and returned as mutable copies. */
describe('shared hook chains', () => {
	it('app-level hooks apply identically across all routes (shared head)', async () => {
		const order: string[] = []
		const app = new Elysia()
			.beforeHandle(() => {
				order.push('before')
			})
			.get('/a', () => 'a')
			.get('/b', () => 'b')
			.get('/c', () => 'c')

		await expect((await app.handle(req('/a'))).text()).resolves.toBe('a')
		await expect((await app.handle(req('/b'))).text()).resolves.toBe('b')
		await expect((await app.handle(req('/c'))).text()).resolves.toBe('c')
		expect(order).toEqual(['before', 'before', 'before'])
	})

	it('derive on the shared head reaches every route', async () => {
		const app = new Elysia()
			.derive(() => ({ shared: 'x' }))
			.get('/a', (c: any) => c.shared)
			.get('/b', (c: any) => c.shared)

		await expect((await app.handle(req('/a'))).text()).resolves.toBe('x')
		await expect((await app.handle(req('/b'))).text()).resolves.toBe('x')
	})
})

describe('per-app macro expansion', () => {
	it('macro-less app compiled first does not strip the macro app of hooks', async () => {
		let macroRan = 0

		const sharedPlugin = new Elysia({ name: 'shared-plugin' })
			.beforeHandle(() => {})
			.get('/plug', () => 'plug')

		const macroLess = new Elysia().use(sharedPlugin).get('/a', () => 'a')

		const withMacro = new Elysia()
			.use(sharedPlugin)
			.macro({
				audit(enabled: boolean) {
					return {
						beforeHandle() {
							if (enabled) macroRan++
						}
					}
				}
			})
			.get('/b', { audit: true } as any, () => 'b')

		;(macroLess as any).compile()
		;(withMacro as any).compile()

		await expect((await macroLess.handle(req('/a'))).text()).resolves.toBe(
			'a'
		)
		await expect(
			(await macroLess.handle(req('/plug'))).text()
		).resolves.toBe('plug')

		const res = await withMacro.handle(req('/b'))
		await expect(res.text()).resolves.toBe('b')
		expect(macroRan).toBe(1)
	})

	it('macro app compiled first does not leak macro hooks into the macro-less app', async () => {
		let macroRan = 0

		const sharedPlugin = new Elysia({ name: 'shared-plugin-reverse' })
			.beforeHandle(() => {})
			.get('/plug', () => 'plug')

		const withMacro = new Elysia()
			.use(sharedPlugin)
			.macro({
				audit(enabled: boolean) {
					return {
						beforeHandle() {
							if (enabled) macroRan++
						}
					}
				}
			})
			.get('/b', { audit: true } as any, () => 'b')

		const macroLess = new Elysia().use(sharedPlugin).get('/a', () => 'a')

		;(withMacro as any).compile()
		;(macroLess as any).compile()

		await expect((await macroLess.handle(req('/a'))).text()).resolves.toBe(
			'a'
		)

		const res = await withMacro.handle(req('/b'))
		await expect(res.text()).resolves.toBe('b')
		expect(macroRan).toBe(1)
	})
})

describe('cached hook-chain copies', () => {
	it('two consumers of one plugin keep independent hooks', async () => {
		const sharedPlugin = new Elysia({ name: 'shared-hooks' })
			.beforeHandle(() => {})
			.get('/p', () => 'p')

		const a = new Elysia()
			.use(sharedPlugin)
			.afterHandle(({ responseValue }) => `${responseValue}-A`)
			.get('/x', () => 'x')

		const b = new Elysia()
			.use(sharedPlugin)
			.afterHandle(({ responseValue }) => `${responseValue}-B`)
			.get('/y', () => 'y')

		;(a as any).compile()
		;(b as any).compile()

		await expect((await a.handle(req('/x'))).text()).resolves.toBe('x-A')
		await expect((await b.handle(req('/y'))).text()).resolves.toBe('y-B')
		expect((await a.handle(req('/p'))).status).toBe(200)
		expect((await b.handle(req('/p'))).status).toBe(200)
	})
})
