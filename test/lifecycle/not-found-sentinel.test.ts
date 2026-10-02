import { Elysia, NotFound } from '../../src'
import { trace } from '../../src/plugin/trace'
import { describe, expect, it } from 'bun:test'

const NOT_FOUND_BODY = JSON.stringify({
	type: 'not-found',
	code: 'not-found',
	status: 404,
	title: 'Not Found'
})

const expectNoSentinelLeak = (body: string) => {
	// the sentinel is `{ code: 'NOT_FOUND' }` — a leak would surface as a
	// bare code-record serialization instead of a problem+json Error body.
	// A problem body carries its own `code`, so the sentinel's *value* is what
	// discriminates
	expect(body).not.toContain('frameworkNotFound')
	expect(body).not.toContain('NOT_FOUND')
	expect(body).not.toContain('{"code"')
}

describe('NotFound miss sentinel', () => {
	it('plain miss with no hooks returns the byte-identical cached 404', async () => {
		const app = new Elysia().get('/', () => 'hi')

		const response = await app.handle('/missing')

		expect(response.status).toBe(404)
		expect(response.headers.get('content-type')).toBe(
			'application/problem+json'
		)
		await expect(response.text()).resolves.toBe(NOT_FOUND_BODY)
	})

	it('dynamic-route miss with no hooks returns the byte-identical cached 404', async () => {
		const app = new Elysia().get('/user/:id', ({ params }) => params.id)

		const response = await app.handle('/missing')

		expect(response.status).toBe(404)
		await expect(response.text()).resolves.toBe(NOT_FOUND_BODY)
	})

	it('error hook observes a real NotFound Error with fields and stack', async () => {
		let observed: unknown

		const app = new Elysia()
			.get('/', () => 'hi')
			.error(({ error }) => {
				observed = error
			})

		const response = await app.handle('/missing')

		expect(observed instanceof NotFound).toBe(true)
		expect((observed as NotFound).status).toBe(404)
		expect((observed as NotFound).message).toBe('Not Found')
		expect(typeof (observed as Error).stack).toBe('string')
		expect((observed as Error).stack!.length).toBeGreaterThan(0)

		// hook returned undefined -> response identical to the no-hook 404
		expect(response.status).toBe(404)
		await expect(response.text()).resolves.toBe(NOT_FOUND_BODY)
	})

	it('dynamic-route miss with error hook observes a real NotFound', async () => {
		let observed: unknown

		const app = new Elysia()
			.get('/user/:id', ({ params }) => params.id)
			.error(({ error }) => {
				observed = error
			})

		const response = await app.handle('/missing')

		expect(observed instanceof NotFound).toBe(true)
		expect(response.status).toBe(404)
		await expect(response.text()).resolves.toBe(NOT_FOUND_BODY)
	})

	it('error hook can return a custom response for a miss', async () => {
		const app = new Elysia()
			.get('/', () => 'hi')
			.error(({ error, set }) => {
				if (error instanceof NotFound) {
					set.status = 404

					return 'custom not found'
				}
			})

		const response = await app.handle('/missing')

		expect(response.status).toBe(404)
		await expect(response.text()).resolves.toBe('custom not found')
	})

	it('rethrowing error hook never leaks the sentinel', async () => {
		// baseline (pre-sentinel) behavior: a hook that throws inside the
		// error pipeline falls into the internal-server-error funnel with
		// the materialized NotFound as detail — pinned byte-identical here
		const app = new Elysia()
			.get('/', () => 'hi')
			.error(({ error }) => {
				throw error
			})

		const response = await app.handle('/missing')
		const body = await response.text()

		expect(response.status).toBe(500)
		expect(body).toBe(
			JSON.stringify({
				type: 'internal-server-error',
				code: 'internal-server-error',
				title: 'Internal Server Error',
				status: 500,
				detail: 'Not Found',
				name: 'NotFound'
			})
		)
		expectNoSentinelLeak(body)
	})

	it('async error hook observes a real NotFound', async () => {
		let observed: unknown

		const app = new Elysia()
			.get('/', () => 'hi')
			.error(async ({ error }) => {
				observed = error
			})

		const response = await app.handle('/missing')

		expect(observed instanceof NotFound).toBe(true)
		expect(response.status).toBe(404)
		await expect(response.text()).resolves.toBe(NOT_FOUND_BODY)
	})

	it('miss with trace and afterResponse observes consistent state, no leak', async () => {
		let traced = false
		let afterResponseError: unknown = 'untouched'
		let hookError: unknown

		const app = new Elysia()
			.use(trace())
			.trace(({ onRequest }) => {
				traced = true
				onRequest(({ onStop }) => {
					onStop(() => {})
				})
			})
			.get('/', () => 'hi')
			.error(({ error }) => {
				hookError = error
			})
			.afterResponse((context) => {
				afterResponseError = (context as any).error
			})

		const response = await app.handle('/missing')
		const body = await response.text()

		expect(traced).toBe(true)
		expect(response.status).toBe(404)
		expect(body).toBe(NOT_FOUND_BODY)
		expectNoSentinelLeak(body)

		expect(hookError instanceof NotFound).toBe(true)

		// afterResponse runs on a microtask
		await new Promise((resolve) => setTimeout(resolve, 10))
		expect(afterResponseError instanceof NotFound).toBe(true)
	})

	it('miss with request hook still materializes for the error hook', async () => {
		let observed: unknown

		const app = new Elysia()
			.request(() => {})
			.get('/', () => 'hi')
			.error(({ error }) => {
				observed = error
			})

		const response = await app.handle('/missing')

		expect(observed instanceof NotFound).toBe(true)
		expect(response.status).toBe(404)
		await expect(response.text()).resolves.toBe(NOT_FOUND_BODY)
	})

	it('static-route hit is unaffected', async () => {
		const app = new Elysia()
			.get('/', () => 'hi')
			.error(() => 'should not run')

		const response = await app.handle('/')

		expect(response.status).toBe(200)
		await expect(response.text()).resolves.toBe('hi')
	})

	it('user-thrown NotFound is a real Error, not conflated with the sentinel', async () => {
		let observed: unknown

		const custom = new NotFound('custom message')

		const app = new Elysia()
			.get('/', () => {
				throw custom
			})
			.error(({ error }) => {
				observed = error
			})

		const response = await app.handle('/')

		// exact user instance, custom field intact — a sentinel swap would
		// lose identity and reset the message
		expect(observed).toBe(custom)
		expect((observed as NotFound).message).toBe('custom message')
		expect(response.status).toBe(404)
	})

	it('user-thrown NotFound without hooks keeps the problem+json shape', async () => {
		const app = new Elysia().get('/', () => {
			throw new NotFound()
		})

		const response = await app.handle('/')

		expect(response.status).toBe(404)
		await expect(response.text()).resolves.toBe(NOT_FOUND_BODY)
	})
})
