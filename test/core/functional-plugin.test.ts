import { Elysia, HTTPError, status } from '../../src'

import { describe, expect, it } from 'bun:test'

class OutOfCredit extends HTTPError.id('OUT_OF_CREDIT', 402) {}

const deny = ({ request }: { request: Request }) =>
	request.headers.has('x-deny') ? status(401, 'no') : undefined

const denied = (path: string) =>
	new Request(`http://localhost${path}`, { headers: { 'x-deny': '1' } })

// A functional plugin is handed the parent. What it returns is used as a
// plugin, the same as what an async one resolves to, so a factory returning
// a new instance registers it and one returning `app` merges nothing
describe('sync functional plugin', () => {
	it('registers the routes of the instance a factory returns', async () => {
		const app = new Elysia().use(() =>
			new Elysia().get('/plugin', () => 'plugin')
		)

		const res = await app.handle('/plugin')

		expect(res.status).toBe(200)
		expect(await res.text()).toBe('plugin')
	})

	it('uses a returned module the same way', async () => {
		const app = new Elysia().use(() => ({
			default: new Elysia().get('/plugin', () => 'plugin')
		}))

		expect(await (await app.handle('/plugin')).text()).toBe('plugin')
	})

	it('registers each instance of a returned array', async () => {
		const app = new Elysia()
			.use(() => [
				new Elysia().get('/a', () => 'a'),
				new Elysia().get('/b', () => 'b')
			])
			.use((app) => [new Elysia().get('/c', () => 'c')])

		for (const path of ['/a', '/b', '/c'])
			expect(await (await app.handle(path)).text()).toBe(path.slice(1))
	})

	it('merges what the returned instance adds as a plugin does', async () => {
		const app = new Elysia()
			.use(() =>
				new Elysia()
					.decorate('decorated', 'decorated')
					.derive('plugin', () => ({ scoped: 'scoped' }))
					.derive(() => ({ local: 'local' }))
			)
			.get('/', (ctx) =>
				JSON.stringify([
					ctx.decorated,
					ctx.scoped,
					(ctx as unknown as { local?: string }).local ?? null
				])
			)

		expect(await (await app.handle('/')).json()).toEqual([
			'decorated',
			'scoped',
			null
		])
	})

	it("runs the parent's hooks on the returned instance's routes", async () => {
		const app = new Elysia()
			.onBeforeHandle(deny)
			.use(() => new Elysia().get('/plugin', () => 'plugin'))

		expect((await app.handle(denied('/plugin'))).status).toBe(401)
	})

	it('keeps the parent handlers the returned instance lacks', async () => {
		const app = new Elysia()
			.onError(OutOfCredit, () => status(418, 'parent'))
			.use(() => new Elysia())
			.get('/', () => new OutOfCredit())

		const res = await app.handle('/')

		expect(res.status).toBe(418)
		expect(await res.text()).toBe('parent')
	})

	it('merges nothing when the factory returns the parent', async () => {
		let fired = 0

		const app = new Elysia()
			.get('/before', () => 'before')
			.onBeforeHandle(deny)
			.use((app) =>
				app
					.onRequest(() => {
						fired++
					})
					.get('/after', () => 'after')
			)
			.use((app) => app)

		expect((await app.handle(denied('/before'))).status).toBe(200)
		expect((await app.handle(denied('/after'))).status).toBe(401)
		expect(fired).toBe(2)
	})
})
