import { describe, expect, it } from 'bun:test'
import { Elysia, t } from '../../src'
import {
	factoryCache,
	FACTORY_CACHE_LIMIT
} from '../../src/compile/handler/jit'
import { post } from '../utils'

describe('JIT route factory cache', () => {
	// the factory is shared, so anything per-route must come from its call
	// arguments; caching the produced route function would serve route A's
	// handler, validators and derive for route B
	it('keeps per-route closures when two routes share a factory', async () => {
		const app = (tag: string, id: any, body: any) =>
			new Elysia()
				.derive(() => ({ who: tag }))
				.post(
					`/${tag}/:id`,
					{ params: t.Object({ id }), body },
					({ who, params, body }) =>
						`${tag}:${who}:${typeof params.id}:${JSON.stringify(body)}`
				)

		factoryCache.clear()
		const a = app('a', t.Number(), t.Object({ a: t.String() }))
		const b = app('b', t.String(), t.Object({ b: t.Number() }))

		expect(await (await a.handle(post('/a/1', { a: 'x' }))).text()).toBe(
			'a:a:number:{"a":"x"}'
		)
		const shared = factoryCache.size
		expect(await (await b.handle(post('/b/z', { b: 2 }))).text()).toBe(
			'b:b:string:{"b":2}'
		)
		// premise: both routes went through the same cached factory
		expect(shared).toBeGreaterThan(0)
		expect(factoryCache.size).toBe(shared)

		// each route keeps its own validators
		expect((await a.handle(post('/a/1', { b: 2 }))).status).toBe(422)
		expect((await a.handle(post('/a/z', { a: 'x' }))).status).toBe(422)
		expect((await b.handle(post('/b/z', { a: 'x' }))).status).toBe(422)
	})

	// emitted source embeds dynamic paths and trace names, so distinct
	// sources grow without bound across app churn
	it('stays bounded at the cap', async () => {
		factoryCache.clear()

		for (let i = 0; i <= FACTORY_CACHE_LIMIT; i++) {
			const app = new Elysia().get(
				`/r${i}/:id`,
				({ route, params }) => route + params.id
			)

			expect(
				await (
					await app.handle(new Request(`http://localhost/r${i}/x`))
				).text()
			).toBe(`/r${i}/:idx`)
			expect(factoryCache.size).toBeLessThanOrEqual(FACTORY_CACHE_LIMIT)
		}

		const sources = [...factoryCache.values()].map(String)
		expect(sources.length).toBe((FACTORY_CACHE_LIMIT >> 1) + 1)
		expect(sources.some((s) => s.includes('"/r0/:id"'))).toBe(false)
		expect(
			sources.some((s) => s.includes(`"/r${FACTORY_CACHE_LIMIT}/:id"`))
		).toBe(true)
	})

	// the cache is keyed by a hash of the source: a factory found under it
	// may have compiled another source, and calling it would run another
	// route's handler, hooks and validators for this one
	it('never runs a factory that did not compile the route source', async () => {
		const app = () =>
			new Elysia()
				.onBeforeHandle(() => {})
				.get('/', ({ query }) => `own:${query.q}`)

		factoryCache.clear()
		expect(
			await (
				await app().handle(new Request('http://localhost/?q=1'))
			).text()
		).toBe('own:1')
		// premise: one route, one factory, so its hash is the only key
		expect(factoryCache.size).toBe(1)
		const [[key, factory]] = factoryCache

		// premise: the same source is a verified hit, not compiled again
		expect(
			await (
				await app().handle(new Request('http://localhost/?q=3'))
			).text()
		).toBe('own:3')
		expect(factoryCache.get(key)).toBe(factory)

		let decoyCalls = 0
		factoryCache.set(key, () => {
			decoyCalls++
			return () => new Response('decoy')
		})

		expect(
			await (
				await app().handle(new Request('http://localhost/?q=2'))
			).text()
		).toBe('own:2')
		expect(decoyCalls).toBe(0)
	})
})
