import { Elysia } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('Plugin', () => {
	it('await async nested plugin', async () => {
		const yay = async () => {
			await Bun.sleep(2)

			return new Elysia({ name: 'yay' }).get('/yay', 'yay')
		}

		const wrapper = new Elysia({ name: 'wrapper' }).use(yay())

		const app = new Elysia().use(wrapper)

		await app.modules

		const response = await app.handle(req('/yay'))

		expect(response.status).toBe(200)
	})

	// https://github.com/elysiajs/elysia/issues/1407
	it('merges global context from a functional plugin that returns a new instance', async () => {
		const fooPlugin = () =>
			new Elysia().resolve(() => ({ foo: 'foo value' })).as('global')

		const app = new Elysia()
			.use(fooPlugin())
			.use(() =>
				new Elysia().resolve(() => ({ bar: 'bar value' })).as('global')
			)
			.get('/', ({ foo, bar }: any) => ({ foo, bar }))

		const response = await app.handle(req('/')).then((x) => x.json())

		expect(response).toEqual({ foo: 'foo value', bar: 'bar value' })
	})

	it('functional plugin returning a new instance is order-independent', async () => {
		const fooPlugin = () =>
			new Elysia().resolve(() => ({ foo: 'foo value' })).as('global')

		const app = new Elysia()
			.use(() =>
				new Elysia().resolve(() => ({ bar: 'bar value' })).as('global')
			)
			.use(fooPlugin())
			.get('/', ({ foo, bar }: any) => ({ foo, bar }))

		const response = await app.handle(req('/')).then((x) => x.json())

		expect(response).toEqual({ foo: 'foo value', bar: 'bar value' })
	})

	it('mutate-and-return-app functional plugin is unaffected', async () => {
		const app = new Elysia()
			.use((app) => app.resolve(() => ({ foo: 'foo value' })).as('global'))
			.get('/', ({ foo }: any) => ({ foo }))

		const response = await app.handle(req('/')).then((x) => x.json())

		expect(response).toEqual({ foo: 'foo value' })
	})

	// A factory `.use(() => new Elysia()...)` must behave identically to the
	// equivalent instance `.use(new Elysia()...)`. https://github.com/elysiajs/elysia/issues/1407
	it('factory-form plugin equals instance-form (decorate/state/headers)', async () => {
		const mk = () =>
			new Elysia().decorate('v', 42).state('c', 7).headers({ 'x-h': 'yes' })
		const build = (p: any) =>
			p.get('/', (ctx: any) => ({ v: ctx.v, c: ctx.store.c }))

		const facRes = await build(new Elysia().use(() => mk())).handle(req('/'))
		const instRes = await build(new Elysia().use(mk())).handle(req('/'))

		expect(facRes.headers.get('x-h')).toBe('yes')
		expect(facRes.headers.get('x-h')).toBe(instRes.headers.get('x-h'))
		expect(await facRes.json()).toEqual({ v: 42, c: 7 })
		expect(await instRes.json()).toEqual({ v: 42, c: 7 })
	})

	it('factory-form global resolve reaches a route registered after it', async () => {
		const app = new Elysia()
			.use(() =>
				new Elysia().resolve(() => ({ foo: 'foo value' })).as('global')
			)
			.get('/after', ({ foo }: any) => ({ foo }))

		const response = await app.handle(req('/after')).then((x) => x.json())

		expect(response).toEqual({ foo: 'foo value' })
	})

	it('factory-form local (un-scoped) hook stays local and does not leak to parent siblings', async () => {
		const mk = () =>
			new Elysia()
				.resolve(() => ({ secret: 'S' }))
				.get('/inside', ({ secret }: any) => ({ secret }))
		const build = (p: any) =>
			p.get('/outside', (ctx: any) => ({ secret: ctx.secret ?? null }))

		const factory = build(new Elysia().use(() => mk()))
		const instance = build(new Elysia().use(mk()))

		// resolve is local to the plugin's own routes for BOTH forms
		expect(
			await factory.handle(req('/inside')).then((x) => x.json())
		).toEqual({ secret: 'S' })
		expect(
			await factory.handle(req('/outside')).then((x) => x.json())
		).toEqual({ secret: null })
		expect(
			await instance.handle(req('/outside')).then((x) => x.json())
		).toEqual({ secret: null })
	})

	it('named factory-form plugin used twice is deduplicated', async () => {
		let count = 0
		const mk = () =>
			new Elysia({ name: 'p' }).onBeforeHandle(() => {
				count++
			}).as('global')

		const app = new Elysia()
			.use(() => mk())
			.use(() => mk())
			.get('/', () => 'ok')

		await app.handle(req('/'))

		expect(count).toBe(1)
	})

	it('function plugin returning a non-Elysia value is returned unchanged (merge guard is Elysia-only)', () => {
		const sentinel = { not: 'an elysia instance' }

		const result = new Elysia().use(() => sentinel as any)

		expect(result).toBe(sentinel as any)
	})
})
