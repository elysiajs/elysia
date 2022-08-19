import KingWorld, { Plugin } from '../src'

import { describe, expect, it } from 'bun:test'

const req = (path: string) => new Request(path)

describe('Path', () => {
	it('Handle root', async () => {
		const app = new KingWorld().get('/', () => 'Hi')
		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('Hi')
	})

	it('Handle multiple level', async () => {
		const app = new KingWorld().get<{
			params: {
				id: string
			}
		}>('/this/is/my/deep/nested/root', () => 'Ok')
		const res = await app.handle(req('/this/is/my/deep/nested/root'))

		expect(await res.text()).toBe('Ok')
	})

	it('Return boolean', async () => {
		const app = new KingWorld().get('/', () => true)
		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('true')
	})

	it('Return number', async () => {
		const app = new KingWorld().get('/', () => 617)
		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('617')
	})

	it('Return json', async () => {
		const app = new KingWorld().get('/', () => ({
			name: 'takodachi'
		}))
		const res = await app.handle(req('/'))

		expect(JSON.stringify(await res.json())).toBe(
			JSON.stringify({
				name: 'takodachi'
			})
		)
		expect(res.headers.get('content-type')).toBe('application/json')
	})

	it('Return response', async () => {
		const app = new KingWorld().get(
			'/',
			() =>
				new Response('Shuba Shuba', {
					headers: {
						duck: 'shuba duck'
					},
					status: 418
				})
		)
		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('Shuba Shuba')
		expect(res.status).toBe(418)
		expect(res.headers.get('duck')).toBe('shuba duck')
	})

	it('Parse single param', async () => {
		const app = new KingWorld().get<{
			params: {
				id: string
			}
		}>('/id/:id', ({ params: { id } }) => id)
		const res = await app.handle(req('/id/123'))

		expect(await res.text()).toBe('123')
	})

	it('Parse multiple params', async () => {
		const app = new KingWorld().get<{
			params: {
				id: string
				name: string
			}
		}>('/id/:id/:name', ({ params: { id, name } }) => `${id}/${name}`)
		const res = await app.handle(req('/id/fubuki/kingworld'))

		expect(await res.text()).toBe('fubuki/kingworld')
	})

	it('Accept wildcard', async () => {
		const app = new KingWorld().get('/wildcard/*', () => 'Wildcard')

		const res = await app.handle(req('/wildcard/okayu'))

		expect(await res.text()).toBe('Wildcard')
	})

	it('Default route', async () => {
		const app = new KingWorld().default(
			() =>
				new Response('Not Stonk :(', {
					status: 404
				})
		)

		const res = await app.handle(req('/wildcard/okayu'))

		expect(await res.text()).toBe('Not Stonk :(')
		expect(res.status).toBe(404)
	})

	it('Parse a querystring', async () => {
		const app = new KingWorld().get<{
			query: {
				id: string
			}
		}>('/', ({ query: { id } }) => id)
		const res = await app.handle(req('/?id=123'))

		expect(await res.text()).toBe('123')
	})

	it('Parse multiple querystrings', async () => {
		const app = new KingWorld().get<{
			query: {
				first: string
				last: string
			}
		}>('/', ({ query: { first, last } }) => `${last} ${first}`)
		const res = await app.handle(req('/?first=Fubuki&last=Shirakami'))

		expect(await res.text()).toBe('Shirakami Fubuki')
	})

	it('Handle body', async () => {
		const app = new KingWorld().post<{
			body: string
		}>('/', ({ request }) => request.text())
		const res = await app.handle(
			new Request('/', {
				method: 'POST',
				body: 'Botan'
			})
		)

		expect(await res.text()).toBe('Botan')
	})

	it('Parse JSON body', async () => {
		const body = JSON.stringify({
			name: 'Okayu'
		})

		const app = new KingWorld().post<{
			body: {
				name: string
			}
		}>('/', ({ request }) => request.json())
		const res = await app.handle(
			new Request('/', {
				method: 'POST',
				body,
				headers: {
					'content-type': 'application/json'
				}
			})
		)

		expect(JSON.stringify(await res.json())).toBe(body)
	})

	it('Parse headers', async () => {
		const app = new KingWorld().post<{
			body: {
				name: string
			}
			headers: {
				'x-powered-by': string
			}
		}>('/', ({ headers }) => headers.get('x-powered-by'))
		const res = await app.handle(
			new Request('/', {
				method: 'POST',
				headers: {
					'x-powered-by': 'KingWorld'
				}
			})
		)

		expect(await res.text()).toBe('KingWorld')
	})

	it('Handle group', async () => {
		const app = new KingWorld().group('/gamer', (app) => {
			app.get('/korone', () => 'Yubi Yubi!')
		})
		const res = await app.handle(req('/gamer/korone'))

		expect(await res.text()).toBe('Yubi Yubi!')
	})

	it('Handle plugin', async () => {
		const plugin: Plugin = (app) => app.get('/korone', () => 'Yubi Yubi!')
		const app = new KingWorld().use(plugin)

		const res = await app.handle(req('/korone'))

		expect(await res.text()).toBe('Yubi Yubi!')
	})

	it('Handle error', async () => {
		const error = 'Pardun?'

		const plugin: Plugin = (app) =>
			app.get('/error', () => new Error(error))
		const app = new KingWorld().use(plugin)

		const res = await app.handle(req('/error'))
		const { message } = await res.json<{
			message: string
		}>()

		expect(message).toBe(error)
	})

	it('Handle async', async () => {
		const app = new KingWorld().get('/async', async () => {
			await new Promise<void>((resolve) =>
				setTimeout(() => {
					resolve()
				}, 1)
			)

			return 'Hi'
		})

		const res = await app.handle(req('/async'))
		expect(await res.text()).toBe('Hi')
	})
})
