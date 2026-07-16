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

describe('error handlers', () => {
	it('runs only the handler registered for the error class', async () => {
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

	it('maps status() returned by an error handler', async () => {
		const app = new Elysia()
			.error(CustomError, ({ error }) => status(418, error.message))
			.get('/', () => {
				throw new CustomError('A')
			})

		const response = await app.handle(req('/'))

		expect(response.status).toBe(418)
		await expect(response.text()).resolves.toBe('A')
	})

	it('routes a returned error through its handler', async () => {
		const app = new Elysia()
			.error(CustomError, ({ error }) => status(418, error.message))
			.get('/', () => new CustomError('A'))

		const response = await app.handle(req('/'))

		expect(response.status).toBe(418)
		await expect(response.text()).resolves.toBe('A')
	})

	it('skips afterHandle when a route returns an error', async () => {
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

	it('routes an error returned by an async handler', async () => {
		const app = new Elysia()
			.error(CustomError, ({ error }) => status(418, error.message))
			.get('/', async () => new CustomError('A'))

		const response = await app.handle(req('/'))

		expect(response.status).toBe(418)
		await expect(response.text()).resolves.toBe('A')
	})

	it('routes a static error value through its handler', async () => {
		const app = new Elysia()
			.error(CustomError, ({ error }) => status(418, error.message))
			.get('/', new CustomError('A'))

		const response = await app.handle(req('/'))

		expect(response.status).toBe(418)
		await expect(response.text()).resolves.toBe('A')
	})

	it('maps an unregistered returned error to 500 problem details', async () => {
		const app = new Elysia().get('/', () => new Error('oops'))

		const response = await app.handle(req('/'))

		expect(response.status).toBe(500)
		await expect(response.json()).resolves.toMatchObject({
			type: 'internal-server-error',
			title: 'Internal Server Error',
			status: 500,
			detail: 'oops'
		})
	})

	it('maps a promised error from a synchronous route', async () => {
		const app = new Elysia().get('/', () =>
			Promise.resolve(new Error('oops'))
		)

		const response = await app.handle(req('/'))

		expect(response.status).toBe(500)
		await expect(response.json()).resolves.toMatchObject({
			type: 'internal-server-error',
			title: 'Internal Server Error',
			status: 500,
			detail: 'oops'
		})
	})

	it('runs matching superclass handlers in registration order', async () => {
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

	it('falls through when an error handler returns undefined', async () => {
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

	it("uses the error's declared status for plain handler returns", async () => {
		const app = new Elysia()
			.error(NotFound, ({ error }) => error.message)
			.get('/', () => {
				throw new NotFound()
			})

		const response = await app.handle(req('/'))

		expect(response.status).toBe(404)
		await expect(response.text()).resolves.toBe('Not Found')
	})

	it('applies plugin error handlers according to their scope', async () => {
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

	it('supports narrowing a catch-all handler with instanceof', async () => {
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
		await expect(plain.json()).resolves.toMatchObject({
			type: 'internal-server-error',
			status: 500,
			detail: 'plain'
		})
	})

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

		expect(res.status).toBe(418)
		await expect(res.text()).resolves.toBe('mapped')
	})

	it('onError maps a Blob response and honors its Range request', async () => {
		const app = new Elysia()
			.error(() => new Blob(['error-asset'], { type: 'text/plain' }))
			.get('/boom', () => {
				throw new Error('x')
			})

		const res = await app.handle(req('/boom'))
		expect(res.status).toBe(500)
		await expect(res.text()).resolves.toBe('error-asset')

		const ranged = await app.handle(
			new Request('http://localhost/boom', {
				headers: { range: 'bytes=0-3' }
			})
		)
		expect(ranged.status).toBe(206)
	})
})
