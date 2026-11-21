import { Elysia, t } from '../../src'
import { describe, expect, it } from 'bun:test'
import { req } from '../utils'
import { TypeCompiler } from '@sinclair/typebox/compiler'

describe('precompile', () => {
	it('should not compose a route twice with precompile: true', async () => {
		// Track how many times composeHandler is called by counting
		// the composed handler identity across add() and listen()
		const app = new Elysia({ precompile: true }).post(
			'/things/:id',
			({ body, params }) => ({
				id: params.id,
				name: (body as any).name
			}),
			{
				body: t.Object({ name: t.String() }),
				params: t.Object({ id: t.String() }),
				response: t.Object({ id: t.String(), name: t.String() })
			}
		)

		// After add(), the route should already be composed
		const composedAfterAdd = app.routes[0].composed
		expect(composedAfterAdd).toBeDefined()

		// Directly verify that route.compile() returns the cached handler
		expect(app.routes[0].compile()).toBe(composedAfterAdd)

		app.compile()

		// After compile/listen, the same composed handler should be reused
		const composedAfterCompile = app.routes[0].composed
		expect(composedAfterCompile).toBe(composedAfterAdd)
	})

	it('should not re-compile TypeBox validators on listen with precompile: true', async () => {
		const originalCompile = TypeCompiler.Compile
		let compiles = 0
		TypeCompiler.Compile = ((...args: Parameters<typeof originalCompile>) => {
			compiles++
			return originalCompile(...args)
		}) as typeof originalCompile

		try {
			const app = new Elysia({ precompile: true }).post(
				'/things/:id',
				({ body, params }) => ({ id: params.id, name: (body as any).name }),
				{
					body: t.Object({ name: t.String() }),
					params: t.Object({ id: t.String() }),
					response: t.Object({ id: t.String(), name: t.String() })
				}
			)

			const afterAdd = compiles
			const composedAtAdd = app.routes[0].composed

			app.listen(0)

			expect(compiles).toBe(afterAdd)
			expect(app.routes[0].composed).toBe(composedAtAdd)

			await app.stop()
		} finally {
			TypeCompiler.Compile = originalCompile
		}
	})

	it('global onError returning nothing should run only once per error with precompile', async () => {
		let calls = 0
		const app = new Elysia({ precompile: true })
			.onError({ as: 'global' }, () => {
				calls++
			})
			.get('/boom', () => {
				throw new Error('boom')
			})

		const response = await app.handle(req('/boom'))
		// The error handler should be called exactly once
		expect(calls).toBe(1)
		// The response should contain the error message
		expect(response.status).toBe(500)
	})

	it('onError registered after a route should NOT catch errors from that route with precompile', async () => {
		const app = new Elysia({ precompile: true })
			.get('/boom', () => {
				throw new Error('boom')
			})
			.onError(() => new Response('late onError', { status: 500 }))

		const response = await app.handle(req('/boom'))
		const text = await response.text()
		// The late onError should NOT apply to the already-registered route.
		// The error message should be the original "boom", not "late onError".
		expect(text).not.toBe('late onError')
	})

	it('onRequest registered before a route applies to precompiled route', async () => {
		const app = new Elysia({ precompile: true })
			.onRequest(({ set }) => {
				set.status = 201
				set.headers['x-test'] = 'yes'
			})
			.get('/test', () => 'hello')

		const res = await app.handle(req('/test'))
		expect(res.status).toBe(201)
		expect(res.headers.get('x-test')).toBe('yes')
	})

	it('precompile route should handle requests correctly', async () => {
		const app = new Elysia({ precompile: true })
			.get('/', () => 'hello')
			.post('/echo', ({ body }) => body, {
				body: t.Object({ msg: t.String() })
			})

		const getRes = await app.handle(req('/')).then((r) => r.text())
		expect(getRes).toBe('hello')

		const postRes = await app
			.handle(
				req('/echo', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ msg: 'hi' })
				})
			)
			.then((r) => r.json())

		expect(postRes).toEqual({ msg: 'hi' })
	})

	it('precompile should work correctly without precompile too', async () => {
		// Ensure the fix doesn't break non-precompile mode
		let calls = 0
		const app = new Elysia()
			.onError({ as: 'global' }, () => {
				calls++
			})
			.get('/boom', () => {
				throw new Error('boom')
			})

		const response = await app.handle(req('/boom'))
		expect(calls).toBe(1)
		expect(response.status).toBe(500)
	})
})
