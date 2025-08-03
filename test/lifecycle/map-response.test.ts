import { Elysia, form } from '../../src'

import { describe, expect, it } from 'bun:test'
import { req } from '../utils'

describe('Map Response', () => {
	it('work global', async () => {
		const app = new Elysia()
			.mapResponse(() => new Response('A'))
			.get('/', () => 'Hutao')

		const res = await app.handle(req('/')).then((x) => x.text())

		expect(res).toBe('A')
	})

	it('work local', async () => {
		const app = new Elysia().get('/', () => 'Hutao', {
			mapResponse() {
				return new Response('A')
			}
		})

		const res = await app.handle(req('/')).then((x) => x.text())

		expect(res).toBe('A')
	})

	it('set header', async () => {
		const app = new Elysia().get(
			'/',
			({ set }) => {
				set.headers['X-Powered-By'] = 'Elysia'

				return 'a'
			},
			{
				mapResponse() {
					return new Response('A', {
						headers: {
							'X-Test': 'OK'
						}
					})
				}
			}
		)

		const headers = await app.handle(req('/')).then((x) => x.headers)

		expect(headers.get('X-Test')).toContain('OK')
		expect(headers.get('X-Powered-By')).toContain('Elysia')
	})

	it('inherits plugin', async () => {
		const plugin = new Elysia().mapResponse(
			{ as: 'global' },
			() => new Response('Fubuki')
		)

		const app = new Elysia().use(plugin).get('/', () => 'a')

		const res = await app.handle(req('/')).then((t) => t.text())
		expect(res).toBe('Fubuki')
	})

	it('not inherits plugin on local', async () => {
		const plugin = new Elysia().mapResponse(() => new Response('Fubuki'))

		const app = new Elysia().use(plugin).get('/', () => 'a')

		const res = await app.handle(req('/')).then((t) => t.text())
		expect(res).toBe('a')
	})

	it('map response only once', async () => {
		const app = new Elysia().get('/', () => 'Hutao', {
			mapResponse: [
				() => {},
				() => {
					return new Response('A')
				},
				() => {
					return new Response('B')
				}
			]
		})

		const res = await app.handle(req('/')).then((x) => x.text())

		expect(res).toBe('A')
	})

	it('inherit response', async () => {
		const app = new Elysia().get('/', () => 'Hu', {
			mapResponse({ response }) {
				if (typeof response === 'string')
					return new Response(response + 'tao')
			}
		})

		const res = await app.handle(req('/')).then((x) => x.text())

		expect(res).toBe('Hutao')
	})

	it('inherit set', async () => {
		const app = new Elysia().get('/', () => 'Hu', {
			mapResponse({ response, set }) {
				set.headers['X-Powered-By'] = 'Elysia'

				if (typeof response === 'string')
					return new Response(response + 'tao', {
						headers: {
							'X-Series': 'Genshin'
						}
					})
			}
		})

		const res = await app.handle(req('/')).then((x) => x.headers)

		expect(res.get('X-Powered-By')).toBe('Elysia')
		expect(res.get('X-Series')).toBe('Genshin')
	})

	it('return async', async () => {
		const app = new Elysia()
			.mapResponse(async () => new Response('A'))
			.get('/', () => 'Hutao')

		const res = await app.handle(req('/')).then((x) => x.text())

		expect(res).toBe('A')
	})

	it('skip async', async () => {
		const app = new Elysia()
			.mapResponse(async () => {})
			.get('/', () => 'Hutao')

		const res = await app.handle(req('/')).then((x) => x.text())

		expect(res).toBe('Hutao')
	})

	it('map response in order', async () => {
		let order = <string[]>[]

		const app = new Elysia()
			.mapResponse(() => {
				order.push('A')
			})
			.mapResponse(() => {
				order.push('B')
			})
			.get('/', () => '')

		await app.handle(req('/'))

		expect(order).toEqual(['A', 'B'])
	})

	it('as global', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.mapResponse({ as: 'global' }, ({ path }) => {
				called.push(path)
			})
			.get('/inner', () => 'NOOP')

		const app = new Elysia().use(plugin).get('/outer', () => 'NOOP')

		const res = await Promise.all([
			app.handle(req('/inner')),
			app.handle(req('/outer'))
		])

		expect(called).toEqual(['/inner', '/outer'])
	})

	it('as local', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.mapResponse({ as: 'local' }, ({ path }) => {
				called.push(path)
			})
			.get('/inner', () => 'NOOP')

		const app = new Elysia().use(plugin).get('/outer', () => 'NOOP')

		const res = await Promise.all([
			app.handle(req('/inner')),
			app.handle(req('/outer'))
		])

		expect(called).toEqual(['/inner'])
	})

	it('support array', async () => {
		let total = 0

		const app = new Elysia()
			.mapResponse([
				() => {
					total++
				},
				() => {
					total++
				}
			])
			.get('/', () => 'NOOP')

		const res = await app.handle(req('/'))

		expect(total).toEqual(2)
	})

	it('mapResponse in error', async () => {
		class CustomClass {
			constructor(public name: string) {}
		}

		const app = new Elysia()
			.trace(() => {})
			.onError(() => new CustomClass('aru'))
			.mapResponse(({ response }) => {
				if (response instanceof CustomClass)
					return new Response(response.name)
			})
			.get('/', () => {
				throw new Error('Hello')
			})

		const response = await app.handle(req('/')).then((x) => x.text())

		expect(response).toBe('aru')
	})

	// https://github.com/elysiajs/elysia/issues/965
	it('mapResponse with after handle', async () => {
		const app = new Elysia()
			.onAfterHandle(() => {})
			.mapResponse((context) => {
				return context.response
			})
			.get('/', async () => 'aru')

		const response = await app.handle(req('/')).then((x) => x.text())

		expect(response).toBe('aru')
	})

	it('mapResponse with onError', async () => {
		const app = new Elysia()
			.onError(() => {})
			.mapResponse(() => {})
			.get('/', () => 'ok')

		const response = await app.handle(req('/')).then((x) => x.text())

		expect(response).toBe('ok')
	})

	it('handle set in mapResonse', async () => {
		const app = new Elysia()
			.mapResponse(({ set }) => {
				set.headers['x-powered-by'] = 'Elysia'
			})
			.get('/', new Response('ok'))

		const response = await app.handle(req('/'))
		const value = await response.text()

		expect(value).toBe('ok')
		expect(response.headers.get('x-powered-by')).toBe('Elysia')
	})
})
