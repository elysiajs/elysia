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

		expect(await app.handle(req('/custom')).then((x) => x.text())).toBe(
			'custom'
		)
		expect(await app.handle(req('/other')).then((x) => x.text())).toBe(
			'other'
		)
	})

	it('map status() returned from handler', async () => {
		const app = new Elysia()
			.error(CustomError, ({ error }) => status(418, error.message))
			.get('/', () => {
				throw new CustomError('A')
			})

		const response = await app.handle(req('/'))

		expect(response.status).toBe(418)
		expect(await response.text()).toBe('A')
	})

	it('forward returned error like a throw', async () => {
		const app = new Elysia()
			.error(CustomError, ({ error }) => status(418, error.message))
			.get('/', () => new CustomError('A'))

		const response = await app.handle(req('/'))

		expect(response.status).toBe(418)
		expect(await response.text()).toBe('A')
	})

	it('forward returned error before afterHandle, like a throw', async () => {
		let ranAfterHandle = false

		const app = new Elysia()
			.error(CustomError, ({ error }) => status(418, error.message))
			.get('/', () => new CustomError('A'), {
				afterHandle: () => {
					ranAfterHandle = true
				}
			})

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
		expect(await response.text()).toBe('A')
	})

	it('forward a static error value', async () => {
		const app = new Elysia()
			.error(CustomError, ({ error }) => status(418, error.message))
			.get('/', new CustomError('A'))

		const response = await app.handle(req('/'))

		expect(response.status).toBe(418)
		expect(await response.text()).toBe('A')
	})

	it('return 500 with message for unregistered returned error', async () => {
		const app = new Elysia().get('/', () => new Error('oops'))

		const response = await app.handle(req('/'))

		expect(response.status).toBe(500)
		expect(await response.text()).toBe('oops')
	})

	it('forward error resolved from a promise on a sync route', async () => {
		const app = new Elysia().get('/', () =>
			Promise.resolve(new Error('oops'))
		)

		const response = await app.handle(req('/'))

		expect(response.status).toBe(500)
		expect(await response.text()).toBe('oops')
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

		expect(await parentFirst.handle(req('/')).then((x) => x.text())).toBe(
			'parent'
		)
		expect(await childFirst.handle(req('/')).then((x) => x.text())).toBe(
			'child'
		)
	})

	it('fall through to the next handler when returning undefined', async () => {
		const app = new Elysia()
			.error(ChildError, () => {})
			.error(CustomError, () => 'parent')
			.get('/', () => {
				throw new ChildError('A')
			})

		expect(await app.handle(req('/')).then((x) => x.text())).toBe('parent')
	})

	it("use the error's declared status for plain returns", async () => {
		const app = new Elysia()
			.error(NotFound, ({ error }) => error.message)
			.get('/', () => {
				throw new NotFound()
			})

		const response = await app.handle(req('/'))

		expect(response.status).toBe(404)
		expect(await response.text()).toBe('Not Found')
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

		expect(await fromLocal.handle(req('/')).then((x) => x.text())).toBe('A')
		expect(await fromPlugin.handle(req('/')).then((x) => x.text())).toBe(
			'handled'
		)
		expect(
			await fromPluginDeep.handle(req('/')).then((x) => x.text())
		).toBe('A')
		expect(
			await fromGlobalDeep.handle(req('/')).then((x) => x.text())
		).toBe('handled')
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

		expect(await app.handle(req('/custom')).then((x) => x.text())).toBe(
			'custom'
		)

		const plain = await app.handle(req('/plain'))

		expect(plain.status).toBe(500)
		expect(await plain.text()).toBe('plain')
	})
})
