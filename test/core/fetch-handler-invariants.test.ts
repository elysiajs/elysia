import { Elysia } from '../../src'
import { createContext } from '../../src/context'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('fetch handler', () => {
	it('does not inspect the request or materialize response state for an empty app', async () => {
		const app = new Elysia().decorate('marker', true)
		const fetch = app.fetch
		const Context = createContext(app)
		const descriptor = Object.getOwnPropertyDescriptor(
			Context.prototype,
			'set'
		)!
		let reads = 0
		let urlReads = 0
		const request = new Proxy(req('/missing'), {
			get(target, key) {
				if (key === 'url') urlReads++
				return Reflect.get(target, key, target)
			}
		})

		Object.defineProperty(Context.prototype, 'set', {
			...descriptor,
			get(this: any) {
				reads++
				return descriptor.get!.call(this)
			}
		})

		try {
			const response = await fetch(request)
			expect(response.status).toBe(404)
			await expect(response.json()).resolves.toEqual({
				type: 'not-found',
				title: 'Not Found',
				status: 404
			})
			expect(urlReads).toBe(0)
			expect(reads).toBe(0)
		} finally {
			Object.defineProperty(Context.prototype, 'set', descriptor)
		}
	})

	it('returns 404 for an unmatched static-only app with a request hook', async () => {
		const app = new Elysia().request(() => {}).get('/exists', () => 'hi')

		const res = await app.handle(req('/nope'))

		expect(res.status).toBe(404)
		await expect(res.json()).resolves.toEqual({
			type: 'not-found',
			title: 'Not Found',
			status: 404
		})
	})

	it('keeps HTTP 500 when an error hook returns a plain object with a status property', async () => {
		const app = new Elysia()
			.error(() => ({ status: 'pending', message: 'retry' }))
			.get('/', () => {
				throw new Error('boom')
			})

		const res = await app.handle(req('/'))

		expect(res.status).toBe(500)
		await expect(res.json()).resolves.toEqual({
			status: 'pending',
			message: 'retry'
		})
	})

	it('uses an explicit status returned from an error hook', async () => {
		const app = new Elysia()
			.error(({ status }) => status(418, 'teapot'))
			.get('/', () => {
				throw new Error('boom')
			})

		const res = await app.handle(req('/'))

		expect(res.status).toBe(418)
		await expect(res.text()).resolves.toBe('teapot')
	})

	it('routes dynamic lookup failures through the error pipeline', async () => {
		let observedRequest: Request | undefined
		const app = new Elysia()
			.error(({ error, path, request }) => {
				observedRequest = request
				return `${error.message}:${path}`
			})
			.get('/id/:id', ({ params }) => params.id)

		void app.fetch
		const router = (app as any)['~router']
		const find = router.find
		router.find = () => {
			throw new Error('router failed')
		}

		const request = req('/id/42')
		try {
			const response = await app.handle(request)
			expect(response.status).toBe(500)
			await expect(response.text()).resolves.toBe('router failed:/id/42')
			expect(observedRequest).toBe(request)
		} finally {
			router.find = find
		}
	})

	it('runs afterResponse when a sync request hook returns a response', async () => {
		let ran = false

		const app = new Elysia()
			.request(({ set }) => {
				set.status = 418
				return 'sc'
			})
			.afterResponse(() => {
				ran = true
			})
			.get('/x', () => 'real')

		const res = await app.handle(req('/x'))
		expect(res.status).toBe(418)

		await Bun.sleep(1)
		expect(ran).toBe(true)
	})

	it('runs afterResponse when an async request hook returns a response', async () => {
		let ran = false

		const app = new Elysia()
			.request(async ({ set }) => {
				set.status = 418
				return 'sc'
			})
			.afterResponse(() => {
				ran = true
			})
			.get('/x', () => 'real')

		const res = await app.handle(req('/x'))
		expect(res.status).toBe(418)

		await Bun.sleep(1)
		expect(ran).toBe(true)
	})

	it('includes configured default headers in the default 404 response', async () => {
		const app = new Elysia()
			.headers({ 'x-powered-by': 'elysia' })
			.get('/exists', () => 'hi')

		const hit = await app.handle(req('/exists'))
		expect(hit.headers.get('x-powered-by')).toBe('elysia')

		const miss = await app.handle(req('/missing'))
		expect(miss.status).toBe(404)
		expect(miss.headers.get('x-powered-by')).toBe('elysia')
	})

	it('includes request-hook headers in the default 404 response', async () => {
		const app = new Elysia()
			.request(({ set }) => {
				set.headers['x-from-hook'] = 'yes'
			})
			.get('/exists', () => 'hi')

		const miss = await app.handle(req('/missing'))
		expect(miss.status).toBe(404)
		expect(miss.headers.get('x-from-hook')).toBe('yes')
	})

	it('afterResponse observes the status chosen by an error hook for a missing route', async () => {
		let observed: number | undefined

		const app = new Elysia()
			.error(({ set }) => {
				set.status = 418
				return 'teapot'
			})
			.afterResponse(({ set }) => {
				observed = set.status as number
			})
			.get('/x', () => 'real')

		const res = await app.handle(req('/missing'))
		expect(res.status).toBe(418)
		await expect(res.text()).resolves.toBe('teapot')

		await Bun.sleep(1)
		expect(observed).toBe(418)
	})
})
