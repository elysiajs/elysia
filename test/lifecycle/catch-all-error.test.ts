// Runtime twin of the catch-all block in test/types/error.ts: what each route
// serves is what its type says it can

import { describe, expect, it } from 'bun:test'
import { Elysia, HTTPError, status, t } from '../../src'
import { websocket } from '../../src/plugin/websocket'

class Lib extends Error {
	readonly lib = true
}

class Other extends Error {
	readonly other = true
}

class OutOfCredit extends HTTPError.id('OUT_OF_CREDIT', 402) {}

const serve = async (
	app: Elysia<any, any, any, any, any, any, any, any>,
	path: string
) => {
	const response = await app.handle(new Request(`http://localhost${path}`))

	return [response.status, await response.text()] as const
}

describe('catch-all error hook', () => {
	it('answers a returned error from a route hook', async () => {
		const app = new Elysia()
			.get(
				'/status',
				{ error: () => status(503, 'down') },
				() => new Lib('x')
			)
			.get('/plain', { error: () => 'fallback' }, () => new Lib('x'))
			.get(
				'/credit',
				{ error: () => 'fallback' },
				() => new OutOfCredit()
			)

		expect(await serve(app, '/status')).toEqual([503, 'down'])
		// a plain value is served at the caught error's status
		expect(await serve(app, '/plain')).toEqual([500, 'fallback'])
		expect(await serve(app, '/credit')).toEqual([402, 'fallback'])
	})

	it('passes an error on when it returns nothing', async () => {
		const app = new Elysia().get(
			'/',
			{
				error: ({ error }) =>
					error instanceof Other ? undefined : 'fallback'
			},
			({ query }) => (query.other ? new Other('x') : new Lib('x'))
		)

		expect(await serve(app, '/')).toEqual([500, 'fallback'])

		const [code, body] = await serve(app, '/?other=1')
		expect(code).toBe(500)
		expect(JSON.parse(body).code).toBe('internal-server-error')
	})

	it('answers a returned error from `.onError(fn)` at any scope', async () => {
		const local = new Elysia()
			.onError(() => status(503, 'down'))
			.get('/', () => new Lib('x'))
		const global = new Elysia()
			.onError('global', () => 'fallback')
			.get('/', () => new OutOfCredit())

		expect(await serve(local, '/')).toEqual([503, 'down'])
		expect(await serve(global, '/')).toEqual([402, 'fallback'])
	})

	it('answers a thrown error too', async () => {
		const app = new Elysia().get(
			'/',
			{ error: () => 'fallback' },
			(): string => {
				throw new Lib('x')
			}
		)

		expect(await serve(app, '/')).toEqual([500, 'fallback'])
	})

	it('answers a validation error at 422', async () => {
		const query = t.Object({ n: t.Numeric() })
		const app = new Elysia()
			.get('/route', { query, error: () => 'fallback' }, () => 'ok')
			.onError(({ error }) =>
				error instanceof Other ? undefined : 'maybe'
			)
			.get('/passes', { query }, () => 'ok')

		expect(await serve(app, '/route?n=x')).toEqual([422, 'fallback'])
		expect(await serve(app, '/passes?n=x')).toEqual([422, 'maybe'])
	})

	it('runs handlers in registration order, a route hook last', async () => {
		const classFirst = new Elysia()
			.onError(Lib, () => status(418, 'class'))
			.onError(() => status(503, 'all'))
			.get('/', () => new Lib('x'))
		const catchAllFirst = new Elysia()
			.onError(() => status(503, 'all'))
			.onError(Lib, () => status(418, 'class'))
			.get('/', () => new Lib('x'))
		const routeLast = new Elysia()
			.onError(Lib, () => status(418, 'class'))
			.get('/', { error: () => status(503, 'route') }, () => new Lib('x'))

		expect(await serve(classFirst, '/')).toEqual([418, 'class'])
		expect(await serve(catchAllFirst, '/')).toEqual([503, 'all'])
		expect(await serve(routeLast, '/')).toEqual([418, 'class'])
	})

	it("lets a parent's handler registered before `.use()` take over", async () => {
		const app = new Elysia()
			.onError(Lib, () => status(418, 'parent'))
			.use(
				new Elysia()
					.get(
						'/route',
						{ error: () => status(503, 'route') },
						() => new Lib('x')
					)
					.onError(() => status(503, 'plugin'))
					.get('/instance', () => new Lib('x'))
			)

		expect(await serve(app, '/route')).toEqual([418, 'parent'])
		expect(await serve(app, '/instance')).toEqual([418, 'parent'])
	})
})

describe('catch-all error hook, order the types cannot see', () => {
	class Credit extends HTTPError.id('CREDIT', 402) {}

	const query = t.Object({ n: t.Numeric() })

	it('runs catch-alls of different scopes in registration order', async () => {
		const app = new Elysia()
			.onError(() => 'local')
			.onError('global', () => 'global')
			.get('/', () => new Lib('x'))

		expect(await serve(app, '/')).toEqual([500, 'local'])
	})

	it("passes from a parent's catch-all on to the plugin's", async () => {
		const app = new Elysia()
			.onError(({ query }) => (query.pass ? undefined : 'parent'))
			.use(
				new Elysia().onError(() => 'child').get('/', () => new Lib('x'))
			)

		expect(await serve(app, '/')).toEqual([500, 'parent'])
		expect(await serve(app, '/?pass=1')).toEqual([500, 'child'])
	})

	it('lets a class handler or a parent catch a validation error', async () => {
		const classFirst = new Elysia()
			.onError(Error, () => status(409, 'class'))
			.onError(() => status(503, 'all'))
			.get('/', { query }, () => 'ok')
		const schema = new Elysia().get(
			'/',
			{
				query,
				error: () => 'fallback',
				response: {
					200: t.Literal('ok'),
					422: t.Object({ why: t.String() })
				}
			},
			() => 'ok' as const
		)
		const parent = new Elysia()
			.onError(() => 'parent')
			.use(
				new Elysia().get(
					'/',
					{ query, error: () => 'child' },
					() => 'ok'
				)
			)

		expect(await serve(classFirst, '/?n=x')).toEqual([409, 'class'])
		expect(await serve(schema, '/?n=x')).toEqual([422, 'fallback'])
		expect(await serve(parent, '/?n=x')).toEqual([422, 'parent'])
	})

	it("runs a WebSocket route's own `error` hook first", async () => {
		const app = new Elysia()
			.use(websocket())
			.onError(() => 'app')
			.ws('/', { query, error: () => 'own', message: () => 'ok' })

		const response = await app.handle(
			new Request('http://localhost/?n=x', {
				headers: { upgrade: 'websocket' }
			})
		)

		expect([response.status, await response.text()]).toEqual([422, 'own'])
	})

	it('serves a guard, group or macro answer at the error status', async () => {
		const guard = new Elysia()
			.guard({ error: () => 'guard' })
			.get('/', () => new Credit())
		const group = new Elysia().group(
			'/group',
			{ error: () => 'group' },
			(app) => app.get('/', () => new Credit())
		)
		const macro = new Elysia()
			.macro({ rescue: { error: () => 'macro' } })
			.get('/', { rescue: true }, () => new Credit())
		const guardValidation = new Elysia()
			.guard({ error: () => 'guard' })
			.get('/', { query }, () => 'ok')

		expect(await serve(guard, '/')).toEqual([402, 'guard'])
		expect(await serve(group, '/group')).toEqual([402, 'group'])
		expect(await serve(macro, '/')).toEqual([402, 'macro'])
		expect(await serve(guardValidation, '/?n=x')).toEqual([422, 'guard'])
	})

	it('serves the internal-server-error problem when a hook throws or hands back an error', async () => {
		const handlers: Array<() => string> = [() => 'array']
		const array = new Elysia()
			.onError(handlers)
			.get('/', () => new Lib('x'))
		const throws = new Elysia()
			.onError((): never => {
				throw new Error('hook')
			})
			.get('/', () => new Lib('x'))
		const errorBack = new Elysia()
			.onError(() => new Lib('again'))
			.get('/', () => new Credit())

		expect(await serve(array, '/')).toEqual([500, 'array'])

		const [code, body] = await serve(throws, '/')
		expect(code).toBe(500)
		expect(JSON.parse(body).code).toBe('internal-server-error')

		// served as an unhandled error, at its own status: `Lib` has none, so
		// not the caught error's 402
		const [backCode, back] = await serve(errorBack, '/')
		expect(backCode).toBe(500)
		expect(JSON.parse(back)).toMatchObject({
			code: 'internal-server-error',
			status: 500
		})
	})

	it('serves an error a hook hands back at its own status, without dispatching it', async () => {
		let dispatched = false
		const app = new Elysia()
			.onError(() => new OutOfCredit())
			.onError(OutOfCredit, () => {
				dispatched = true

				return status(418, 'teapot')
			})
			.get('/', () => new Lib('x'))

		const [code, body] = await serve(app, '/')
		expect(code).toBe(402)
		expect(JSON.parse(body)).toMatchObject({
			code: 'OUT_OF_CREDIT',
			status: 402
		})
		// no `.onError(OutOfCredit)` dispatch, so no loop either
		expect(dispatched).toBe(false)
	})
})
