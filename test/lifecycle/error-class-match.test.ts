// Runtime twin of the structural matching block in test/types/error.ts: a
// handler for a class that adds nothing to `Error` only catches its own
// instances, `Error` itself catches every error

import { describe, expect, it } from 'bun:test'
import { Elysia, HTTPError, status, t } from '../../src'
import { websocket } from '../../src/plugin/websocket'

class EmptyA extends Error {}
class Empty extends Error {}
class EmptyB extends Error {}
class RateLimited extends HTTPError.id('RATE_LIMITED', 429) {}

class Named extends Error {
	name = 'Named' as const
}

class OtherNamed extends Error {
	name = 'OtherNamed' as const
}

const serve = async (
	app: Elysia<any, any, any, any, any, any, any, any>,
	path = '/'
) => {
	const response = await app.handle(new Request(`http://localhost${path}`))

	return [response.status, await response.text()] as const
}

describe('error class match', () => {
	it('catches only instances of a class that adds nothing to Error', async () => {
		const twin = new Elysia()
			.onError(EmptyA, () => status(418, 'teapot'))
			.get('/', () => new EmptyB())
		const unrelated = new Elysia()
			.onError(EmptyA, () => status(401, 'no'))
			.get('/', () => new RateLimited())
		const own = new Elysia()
			.onError(EmptyA, () => status(401, 'no'))
			.get('/', () => new EmptyA())

		const [twinCode, twinBody] = await serve(twin)
		expect(twinCode).toBe(500)
		expect(JSON.parse(twinBody).code).toBe('internal-server-error')

		const [code, body] = await serve(unrelated)
		expect(code).toBe(429)
		expect(JSON.parse(body).code).toBe('RATE_LIMITED')

		expect(await serve(own)).toEqual([401, 'no'])
	})

	it('catches every error with `Error`, not with `TypeError`', async () => {
		const error = new Elysia()
			.onError(Error, () => status(418, 'any'))
			.get('/', () => new RateLimited())
		const typeError = new Elysia()
			.onError(TypeError, () => status(400, 'type'))
			.get('/', () => new RateLimited())

		expect(await serve(error)).toEqual([418, 'any'])
		expect((await serve(typeError))[0]).toBe(429)
	})

	it('tells classes apart by their own members', async () => {
		const app = new Elysia()
			.onError(Named, () => status(418, 'named'))
			.get('/named', () => new Named('x'))
			.get('/other', () => new OtherNamed('x'))

		expect(await serve(app, '/named')).toEqual([418, 'named'])
		expect((await serve(app, '/other'))[0]).toBe(500)
	})
})

describe("a parent's error handler and a plugin route's validation", () => {
	const query = t.Object({ n: t.Numeric() })
	const plugin = () => new Elysia().get('/', { query }, () => 'ok')

	it('runs the handlers registered before `.use()` first', async () => {
		const error = new Elysia()
			.onError(Error, () => status(418, 'parent'))
			.use(plugin())
		const deep = new Elysia()
			.onError(Error, () => status(418, 'top'))
			.use(new Elysia().use(plugin()))
		const both = new Elysia()
			.onError(Error, () => status(418, 'parent'))
			.use(
				new Elysia()
					.onError(Error, () => status(409, 'plugin'))
					.get('/', { query }, () => 'ok')
			)

		expect(await serve(error, '/?n=x')).toEqual([418, 'parent'])
		expect(await serve(deep, '/?n=x')).toEqual([418, 'top'])
		expect(await serve(both, '/?n=x')).toEqual([418, 'parent'])
	})

	it('skips a class it is no instance of, and one registered later', async () => {
		const empty = new Elysia()
			.onError(Empty, () => status(401, 'empty'))
			.use(plugin())
		const member = new Elysia()
			.onError(RateLimited, () => status(418, 'limited'))
			.use(plugin())
		const late = new Elysia()
			.use(plugin())
			.onError(Error, () => status(418, 'late'))

		for (const app of [empty, member, late]) {
			const [code, body] = await serve(app, '/?n=x')
			expect(code).toBe(422)
			expect(JSON.parse(body).code).toBe('validation')
		}
	})

	it("answers a WebSocket route's upgrade", async () => {
		const app = new Elysia()
			.onError(Error, () => status(418, 'parent'))
			.use(
				new Elysia()
					.use(websocket())
					.ws('/', { query, message: () => 'ok' })
			)

		const response = await app.handle(
			new Request('http://localhost/?n=x', {
				headers: { upgrade: 'websocket' }
			})
		)

		expect([response.status, await response.text()]).toEqual([
			418,
			'parent'
		])
	})
})
