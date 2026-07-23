import { describe, expect, it } from 'bun:test'

import { Elysia, t } from '../../src'
import {
	BALANCED_HTTP_PROGRAM_KIND,
	BALANCED_HTTP_PROGRAM_VERSION,
	BalancedHttpUnsupportedError
} from '../../src/compile/handler/balanced-program'

describe('public AppPlan publication', () => {
	it('plans only request-reachable winners with dense identities', async () => {
		const app = new Elysia()
			.get('/same', () => 'old')
			.get('/other', () => 'other')
			.get('/same', () => 'new')
			.get('/dynamic/:id', () => 'old-dynamic')
			.get('/dynamic/:name', ({ params }) => params.name)

		await expect((await app.handle('/same')).text()).resolves.toBe('new')
		await expect((await app.handle('/dynamic/value')).text()).resolves.toBe(
			'value'
		)
		const generation = app['~generation']!
		expect(generation.plan.httpRoutes.map(({ id, path }) => [id, path])).toEqual(
			[
				[0, '/other'],
				[1, '/same'],
				[2, '/dynamic/:name']
			]
		)
		expect(generation.plan.coverage).toMatchObject({
			declaredHttpRoutes: 5,
			winningHttpRoutes: 3,
			shadowedHttpRoutes: 2,
			plannedHttpRoutes: 3
		})
		expect(generation.plan.coverage.plannedHttpRoutes).toBe(
			generation.plan.coverage.winningHttpRoutes
		)
		expect(generation.plan.httpRoutes).toHaveLength(
			generation.plan.coverage.winningHttpRoutes
		)
		expect(generation.plan.httpRoutes.map(({ id }) => id)).toEqual([0, 1, 2])
		for (const route of generation.plan.httpRoutes) {
			expect(route.program.version).toBe(BALANCED_HTTP_PROGRAM_VERSION)
			expect((route.program.content as any).kind).toBe(
				BALANCED_HTTP_PROGRAM_KIND
			)
		}
		expect(Object.isFrozen(generation)).toBeTrue()
		expect(Object.isFrozen(generation.plan)).toBeTrue()
		expect(typeof generation.fetch).toBe('function')
	})

	it('ignores an unsupported loser but rejects an unsupported winner at seal', async () => {
		const supported = new Elysia()
			.post(
				'/winner',
				{ parse: [{}] } as any,
				() => 'loser'
			)
			.post('/winner', () => 'winner')
		await expect((await supported.handle('/winner', { method: 'POST' })).text())
			.resolves.toBe('winner')
		expect(supported['~generation']!.plan.httpRoutes).toHaveLength(1)

		const unsupported = new Elysia()
			.post('/winner', () => 'loser')
			.post(
				'/winner',
				{ parse: [{}] } as any,
				() => 'winner'
			)
		let sealError: Error | undefined
		try {
			void unsupported.fetch
		} catch (error) {
			sealError = error as Error
		}
		expect(sealError).toBeInstanceOf(BalancedHttpUnsupportedError)
		expect(sealError?.message).toContain('route POST /winner')
		expect(unsupported['~generation']).toBeUndefined()
	})

	it('binds application hooks and adapter callbacks without an opaque fetch', () => {
		const app = new Elysia()
			.request(() => {})
			.mapResponse(() => {})
			.error(() => {})
			.afterResponse(() => {})
			.trace(() => {})
			.wrap((next) => (request, ...rest) => next(request, ...rest))
			.get('/', () => 'ok')
		void app.fetch

		const roles = app['~generation']!.plan.bindingLayout
			.filter(({ nodeId }) => nodeId === 0)
			.map(({ role }) => role)
		expect(roles).toEqual([
			'routeErrorFinalizer',
			'request',
			'mapResponse',
			'error',
			'afterResponse',
			'tracer',
			'hoc',
			'server',
			'adapterParse',
			'adapterMap',
			'adapterCompact'
		])
		expect(roles).not.toContain('fetch' as any)
	})

	it('never evaluates generated source after publication', async () => {
		const mounted = new Elysia().get('/inside', () => 'mounted')
		const app = new Elysia()
			.get('/value/:id', ({ params }) => params.id)
			.post(
				'/body',
				{ body: t.Object({ value: t.String() }) },
				({ body }) => body.value
			)
			.get('/hook', { beforeHandle() {} }, () => 'hook')
			.method('PURGE', '/cache', () => 'purged')
			.mount('/mount', mounted.handle)
		app.compile()

		const OriginalFunction = globalThis.Function
		let evaluations = 0
		const fail = () => {
			evaluations++
			throw new Error('request-time source generation')
		}
		;(globalThis as any).Function = new Proxy(OriginalFunction, {
			apply: fail,
			construct: fail
		})

		try {
			for (const [path, init, body] of [
				['/value/one', undefined, 'one'],
				['/value/two', undefined, 'two'],
				[
					'/body',
					{
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ value: 'body' })
					},
					'body'
				],
				['/hook', undefined, 'hook'],
				['/cache', { method: 'PURGE' }, 'purged'],
				['/mount/inside', undefined, 'mounted']
			] as const)
				await expect((await app.handle(path, init)).text()).resolves.toBe(body)
		} finally {
			;(globalThis as any).Function = OriginalFunction
		}

		expect(evaluations).toBe(0)
	})

	it('publishes seal failures separately from request-time rejections', async () => {
		const app = new Elysia().get('/error', async () => {
			throw new Error('request boom')
		})
		const response = await app.handle('/error')

		expect(response.status).toBe(500)
		expect(app['~generation']).toBeDefined()
	})

	it('resolves Unicode aliases and discards unreachable path spellings', async () => {
		const app = new Elysia()
			.get('/café', () => 'raw-old')
			.get('/caf%C3%A9', () => 'encoded-winner')
			.get('/café/:id', () => 'dynamic-old')
			.get('/caf%C3%A9/:name', ({ params }) => params.name)
			.get('/b', () => 'explicit')
			.get('/a/../b', () => 'unreachable')

		await expect((await app.handle('/café')).text()).resolves.toBe(
			'encoded-winner'
		)
		await expect((await app.handle('/café/value')).text()).resolves.toBe(
			'value'
		)
		await expect((await app.handle('/b')).text()).resolves.toBe('explicit')
		expect(app['~generation']!.plan.coverage).toMatchObject({
			declaredHttpRoutes: 6,
			winningHttpRoutes: 3,
			shadowedHttpRoutes: 3
		})
	})

	it('fails old public configuration values at seal', () => {
		for (const [config, reason] of [
			[{ precompile: false }, 'lazy-precompile-false'],
			[
				{ experimental: { cancellation: 'compat' } },
				'compat-cancellation'
			]
		] as const) {
			const app = new Elysia(config as any)
			let sealError: Error | undefined
			try {
				void app.fetch
			} catch (error) {
				sealError = error as Error
			}

			expect(sealError).toBeInstanceOf(BalancedHttpUnsupportedError)
			expect(sealError).toMatchObject({
				name: 'BalancedHttpUnsupportedError',
				code: 'BALANCED_HTTP_UNSUPPORTED',
				reason
			})
			expect(app['~generation']).toBeUndefined()
		}
	})

	it('publishes every handler form through the same plan', async () => {
		const mounted = new Elysia().get('/inside', () => 'mounted')
		const app = new Elysia()
			.get('/function', () => 'function')
			.get('/response', new Response('response'))
			.get('/static', 'static')
			.get('/promise', Promise.resolve('promise') as any)
			.mount('/mount', mounted.handle)

		for (const [path, body] of [
			['/function', 'function'],
			['/response', 'response'],
			['/static', 'static'],
			['/promise', 'promise'],
			['/mount/inside', 'mounted']
		] as const)
			await expect((await app.handle(path)).text()).resolves.toBe(body)

		expect(
			app['~generation']!.plan.httpRoutes.map(({ path, handlerForm }) => [
				path,
				handlerForm
			])
		).toEqual([
			['/function', 'function'],
			['/response', 'response'],
			['/static', 'response'],
			['/promise', 'promise'],
			['/mount', 'mount'],
			['/mount/*', 'mount']
		])
		const plan = app['~generation']!.plan
		expect(plan.coverage.plannedHttpRoutes).toBe(
			plan.coverage.winningHttpRoutes
		)
		expect(plan.httpRoutes).toHaveLength(plan.coverage.winningHttpRoutes)
		for (const route of plan.httpRoutes)
			expect((route.program.content as any).kind).toBe(
				BALANCED_HTTP_PROGRAM_KIND
			)
	})
})
