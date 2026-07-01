import { describe, expect, it } from 'bun:test'

import { Elysia, NotFound, status } from '../../../src'

const req = (path: string) => new Request(`http://localhost${path}`)

class CustomError extends Error {
	readonly kind = 'custom'

	constructor(message: string) {
		super(message)
	}
}

class ChildError extends CustomError {
	readonly child = true
}

class OtherError extends Error {
	readonly kind = 'other'

	constructor(message: string) {
		super(message)
	}
}

describe('Error handler', () => {
	it('run handler only for matching error class', async () => {
		const app = new Elysia()
			.error(CustomError, () => 'custom')
			.error(OtherError, () => 'other')
			.get('/custom', () => {
				throw new CustomError('A')
			})
			.get('/other', () => {
				throw new OtherError('B')
			})

		await expect(
			app.handle(req('/custom')).then((x) => x.text())
		).resolves.toBe('custom')
		await expect(
			app.handle(req('/other')).then((x) => x.text())
		).resolves.toBe('other')
	})

	it('map status() returned from handler', async () => {
		const app = new Elysia()
			.error(CustomError, ({ error }) => status(418, error.message))
			.get('/', () => {
				throw new CustomError('A')
			})

		const response = await app.handle(req('/'))

		expect(response.status).toBe(418)
		await expect(response.text()).resolves.toBe('A')
	})

	it('forward returned error like a throw', async () => {
		const app = new Elysia()
			.error(CustomError, ({ error }) => status(418, error.message))
			.get('/', () => new CustomError('A'))

		const response = await app.handle(req('/'))

		expect(response.status).toBe(418)
		await expect(response.text()).resolves.toBe('A')
	})

	it('forward returned error before afterHandle, like a throw', async () => {
		let ranAfterHandle = false

		const app = new Elysia()
			.error(CustomError, ({ error }) => status(418, error.message))
			.get(
				'/',
				{
					afterHandle: () => {
						ranAfterHandle = true
					}
				},
				() => new CustomError('A')
			)

		const response = await app.handle(req('/'))

		expect(response.status).toBe(418)
		expect(ranAfterHandle).toBe(false)
	})

	it('forward returned error from async handler', async () => {
		const app = new Elysia()
			.error(CustomError, ({ error }) => status(418, error.message))
			.get('/', async () => new CustomError('A'))

		const response = await app.handle(req('/'))

		expect(response.status).toBe(418)
		await expect(response.text()).resolves.toBe('A')
	})

	it('forward a static error value', async () => {
		const app = new Elysia()
			.error(CustomError, ({ error }) => status(418, error.message))
			.get('/', new CustomError('A'))

		const response = await app.handle(req('/'))

		expect(response.status).toBe(418)
		await expect(response.text()).resolves.toBe('A')
	})

	it('return 500 with message for unregistered returned error', async () => {
		const app = new Elysia().get('/', () => new Error('oops'))

		const response = await app.handle(req('/'))

		expect(response.status).toBe(500)
		// unregistered error → RFC 9457 problem+json 500 (message as `detail`)
		await expect(response.json()).resolves.toMatchObject({
			type: 'unknown',
			title: 'Internal Server Error',
			status: 500,
			detail: 'oops'
		})
	})

	it('forward error resolved from a promise on a sync route', async () => {
		const app = new Elysia().get('/', () =>
			Promise.resolve(new Error('oops'))
		)

		const response = await app.handle(req('/'))

		expect(response.status).toBe(500)
		await expect(response.json()).resolves.toMatchObject({
			type: 'unknown',
			title: 'Internal Server Error',
			status: 500,
			detail: 'oops'
		})
	})

	it('run handlers in registration order for subclasses', async () => {
		const parentFirst = new Elysia()
			.error(CustomError, () => 'parent')
			.error(ChildError, () => 'child')
			.get('/', () => {
				throw new ChildError('A')
			})

		const childFirst = new Elysia()
			.error(ChildError, () => 'child')
			.error(CustomError, () => 'parent')
			.get('/', () => {
				throw new ChildError('A')
			})

		await expect(
			parentFirst.handle(req('/')).then((x) => x.text())
		).resolves.toBe('parent')
		await expect(
			childFirst.handle(req('/')).then((x) => x.text())
		).resolves.toBe('child')
	})

	it('fall through to the next handler when returning undefined', async () => {
		const app = new Elysia()
			.error(ChildError, () => {})
			.error(CustomError, () => 'parent')
			.get('/', () => {
				throw new ChildError('A')
			})

		await expect(app.handle(req('/')).then((x) => x.text())).resolves.toBe(
			'parent'
		)
	})

	it("use the error's declared status for plain returns", async () => {
		const app = new Elysia()
			.error(NotFound, ({ error }) => error.message)
			.get('/', () => {
				throw new NotFound()
			})

		const response = await app.handle(req('/'))

		expect(response.status).toBe(404)
		await expect(response.text()).resolves.toBe('Not Found')
	})

	it('apply plugin handlers per scope', async () => {
		const handler = () => 'handled'

		const local = new Elysia().error(CustomError, handler)
		const plugin = new Elysia().error('plugin', CustomError, handler)
		const global = new Elysia().error('global', CustomError, handler)

		const route = () => {
			throw new CustomError('A')
		}

		const fromLocal = new Elysia().use(local).get('/', route)
		const fromPlugin = new Elysia().use(plugin).get('/', route)
		const fromPluginDeep = new Elysia()
			.use(new Elysia().use(plugin))
			.get('/', route)
		const fromGlobalDeep = new Elysia()
			.use(new Elysia().use(global))
			.get('/', route)

		// out-of-scope handler → uncaught CustomError → problem+json 500 (detail 'A')
		await expect(
			fromLocal.handle(req('/')).then((x) => x.json())
		).resolves.toMatchObject({ status: 500, detail: 'A' })
		await expect(
			fromPlugin.handle(req('/')).then((x) => x.text())
		).resolves.toBe('handled')
		await expect(
			fromPluginDeep.handle(req('/')).then((x) => x.json())
		).resolves.toMatchObject({ status: 500, detail: 'A' })
		await expect(
			fromGlobalDeep.handle(req('/')).then((x) => x.text())
		).resolves.toBe('handled')
	})

	it('narrow catch-all with instanceof', async () => {
		const app = new Elysia()
			.error(({ error }) => {
				if (error instanceof CustomError) return 'custom'
			})
			.get('/custom', () => {
				throw new CustomError('A')
			})
			.get('/plain', () => {
				throw new Error('plain')
			})

		await expect(
			app.handle(req('/custom')).then((x) => x.text())
		).resolves.toBe('custom')

		const plain = await app.handle(req('/plain'))

		expect(plain.status).toBe(500)
		// non-CustomError falls through the catch-all → problem+json 500
		await expect(plain.json()).resolves.toMatchObject({
			type: 'unknown',
			status: 500,
			detail: 'plain'
		})
	})

	// Regression (audit H1): an instance-level `.onError` on a plugin must NOT
	// clobber route-level error handlers. A dangling `else;` in the error-merge
	// codegen left the array reassignment outside the branch, so adding any
	// plugin `.onError` overwrote the merged handlers with only the
	// instance-local ones — the route's error mapper was dropped and the raw
	// Error.message (internal detail) leaked with a 500.
	it('instance-level onError does not clobber route-level error handler', async () => {
		const plugin = new Elysia()
			.error(() => {})
			.get(
				'/boom',
				{
					error: () => new Response('mapped', { status: 418 })
				},
				() => {
					throw new Error('SECRET_INTERNAL_DETAIL')
				}
			)

		const app = new Elysia().use(plugin)
		const res = await app.handle(req('/boom'))

		// before the fix: 500 with body 'SECRET_INTERNAL_DETAIL'
		expect(res.status).toBe(418)
		await expect(res.text()).resolves.toBe('mapped')
	})

	// Regression (audit H5): when there are no mapResponse hooks, `mapResponse`
	// IS the bare adapter whose 3rd arg is the Request. createErrorHandler
	// passed the Context instead, so an onError returning a File/Blob hit
	// `context.headers.get('range')` — a TypeError that escaped the fetch
	// handler. The Context's `.request` must be unwrapped for the adapter.
	it('onError returning a Blob responds without crashing (and honours Range)', async () => {
		const app = new Elysia()
			.error(() => new Blob(['error-asset'], { type: 'text/plain' }))
			.get('/boom', () => {
				throw new Error('x')
			})

		const res = await app.handle(req('/boom'))
		expect(res.status).toBe(500)
		await expect(res.text()).resolves.toBe('error-asset')

		// the real Request is now forwarded → range requests work
		const ranged = await app.handle(
			new Request('http://localhost/boom', {
				headers: { range: 'bytes=0-3' }
			})
		)
		expect(ranged.status).toBe(206)
	})
})
