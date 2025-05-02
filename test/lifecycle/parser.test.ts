import { Elysia, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { post } from '../utils'

describe('Parser', () => {
	it('handle onParse', async () => {
		const app = new Elysia()
			.onParse((context, contentType) => {
				switch (contentType) {
					case 'application/Elysia':
						return 'A'
				}
			})
			.post('/', ({ body }) => body)

		const res = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				body: ':D',
				headers: {
					'content-type': 'application/Elysia',
					'content-length': '2'
				}
			})
		)

		expect(await res.text()).toBe('A')
	})

	it('register using on', async () => {
		const app = new Elysia()
			.on('parse', (context, contentType) => {
				switch (contentType) {
					case 'application/Elysia':
						return context.request.text()
				}
			})
			.post('/', ({ body }) => body)

		const res = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				body: ':D',
				headers: {
					'content-type': 'application/Elysia',
					'content-length': '2'
				}
			})
		)

		expect(await res.text()).toBe(':D')
	})

	it('overwrite default parser', async () => {
		const app = new Elysia()
			.onParse((context, contentType) => {
				switch (contentType) {
					case 'text/plain':
						return 'Overwrited'
				}
			})
			.post('/', ({ body }) => body)

		const res = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				body: ':D',
				headers: {
					'content-type': 'text/plain',
					'content-length': '2'
				}
			})
		)

		expect(await res.text()).toBe('Overwrited')
	})

	it('parse x-www-form-urlencoded', async () => {
		const app = new Elysia().post('/', ({ body }) => body)

		const body = {
			username: 'salty aom',
			password: '12345678'
		}

		const res = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				body: `username=${body.username}&password=${body.password}`,
				headers: {
					'content-type': 'application/x-www-form-urlencoded'
				}
			})
		)

		expect(await res.json()).toEqual(body)
	})

	it('parse with extra content-type attribute', async () => {
		const app = new Elysia().post('/', ({ body }) => body)

		const body = {
			username: 'salty aom',
			password: '12345678'
		}

		const res = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				body: JSON.stringify(body),
				headers: {
					'content-type': 'application/json;charset=utf-8'
				}
			})
		)

		expect(await res.json()).toEqual(body)
	})

	it('inline parse', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			parse({ request }) {
				return request.text().then(() => 'hi')
			}
		})

		const res = await app
			.handle(
				new Request('http://localhost/', {
					method: 'POST',
					body: 'ok',
					headers: {
						'Content-Type': 'application/json'
					}
				})
			)
			.then((x) => x.text())

		expect(res).toBe('hi')
	})

	it('map parser in order', async () => {
		let order = <string[]>[]

		const app = new Elysia()
			.onParse({ as: 'global' }, ({ path }) => {
				order.push('A')
			})
			.onParse({ as: 'global' }, ({ path }) => {
				order.push('B')
			})
			.post('/', ({ body }) => 'NOOP')

		const res = await app.handle(post('/', {}))

		expect(order).toEqual(['A', 'B'])
	})

	it('inherits plugin', async () => {
		const plugin = new Elysia().onParse({ as: 'global' }, () => 'Kozeki Ui')

		const app = new Elysia().use(plugin).post('/', ({ body }) => body)

		const res = await app.handle(post('/', {})).then((t) => t.text())
		expect(res).toBe('Kozeki Ui')
	})

	it('not inherits plugin on local', async () => {
		const plugin = new Elysia().onParse(() => 'Kozeki Ui')

		const app = new Elysia().use(plugin).post('/', ({ body }) => body)

		const res = await app
			.handle(post('/', { name: 'Kozeki Ui' }))
			.then((t) => t.json())

		expect(res).toEqual({ name: 'Kozeki Ui' })
	})

	it('as global', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.onParse({ as: 'global' }, ({ path }) => {
				called.push(path)
			})
			.post('/inner', () => 'NOOP')

		const app = new Elysia().use(plugin).post('/outer', () => 'NOOP')

		const res = await Promise.all([
			app.handle(post('/inner', {})),
			app.handle(post('/outer', {}))
		])

		expect(called).toEqual(['/inner', '/outer'])
	})

	it('as local', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.onParse({ as: 'local' }, ({ path }) => {
				called.push(path)
			})
			.post('/inner', () => 'NOOP')

		const app = new Elysia().use(plugin).post('/outer', () => 'NOOP')

		const res = await Promise.all([
			app.handle(post('/inner', {})),
			app.handle(post('/outer', {}))
		])

		expect(called).toEqual(['/inner'])
	})

	it('support array', async () => {
		let total = 0

		const app = new Elysia()
			.onParse([
				() => {
					total++
				},
				() => {
					total++
				}
			])
			.post('/', ({ body }) => 'NOOP')

		const res = await app.handle(post('/', {}))

		expect(total).toEqual(2)
	})

	it('handle type with validator with custom parse', async () => {
		const app = new Elysia().post('/json', ({ body: { name } }) => name, {
			body: t.Object({
				name: t.String()
			}),
			parse: [
				({ contentType }) => {
					if (contentType === 'custom') return { name: 'Mutsuki' }
				},
				'json'
			]
		})

		const [correct, incorrect, custom] = await Promise.all([
			app.handle(post('/json', { name: 'Aru' })).then((x) => x.text()),
			app
				.handle(post('/json', { school: 'Gehenna' }))
				.then((x) => x.status),
			app
				.handle(
					new Request('http://localhost/json', {
						method: 'POST',
						body: JSON.stringify({ name: 'Aru' }),
						headers: {
							'content-type': 'custom'
						}
					})
				)
				.then((x) => x.text())
		])

		expect(correct).toBe('Aru')
		expect(incorrect).toBe(422)
		expect(custom).toBe('Mutsuki')
	})

	it('handle name parser', async () => {
		const app = new Elysia().post('/json', ({ body }) => body, {
			parse: ['json']
		})

		const response = await app
			.handle(
				new Request('http://localhost:3000/json', {
					method: 'POST',
					body: JSON.stringify({ name: 'Aru' })
				})
			)
			.then((x) => x.json())

		expect(response).toEqual({ name: 'Aru' })
	})

	it('handle custom parser then fallback to named default', async () => {
		const app = new Elysia()
			.parser('custom', ({ contentType, request }) => {
				if (contentType.startsWith('application/x-elysia'))
					return { name: 'Eden' }
			})
			.post('/json', ({ body }) => body, {
				parse: ['custom', 'json']
			})

		const response = await Promise.all([
			app
				.handle(
					new Request('http://localhost:3000/json', {
						method: 'POST',
						body: JSON.stringify({ name: 'Aru' })
					})
				)
				.then((x) => x.json()),
			app
				.handle(
					new Request('http://localhost:3000/json', {
						method: 'POST',
						headers: {
							'content-type': 'application/x-elysia'
						},
						body: JSON.stringify({ name: 'Aru' })
					})
				)
				.then((x) => x.json())
		])

		expect(response).toEqual([{ name: 'Aru' }, { name: 'Eden' }])
	})

	it('handle custom parser then fallback to unknown', async () => {
		const app = new Elysia()
			.parser('custom', ({ contentType, request }) => {
				if (contentType.startsWith('application/x-elysia'))
					return { name: 'Eden' }
			})
			.post('/json', ({ body }) => body, {
				parse: ['custom']
			})

		const response = await Promise.all([
			app
				.handle(
					new Request('http://localhost:3000/json', {
						method: 'POST',
						headers: {
							'content-type': 'application/json'
						},
						body: JSON.stringify({ name: 'Aru' })
					})
				)
				.then((x) => x.json()),
			app
				.handle(
					new Request('http://localhost:3000/json', {
						method: 'POST',
						headers: {
							'content-type': 'application/x-elysia'
						},
						body: JSON.stringify({ name: 'Aru' })
					})
				)
				.then((x) => x.json())
		])

		expect(response).toEqual([{ name: 'Aru' }, { name: 'Eden' }])
	})

	it('handle parser from plugin', async () => {
		const plugin = new Elysia().parser(
			'custom',
			({ contentType, request }) => {
				if (contentType === 'application/x-elysia')
					return { name: 'Eden' }
			}
		)

		const app = new Elysia()
			.use(plugin)
			.parser('custom2', ({ contentType, request }) => {
				if (contentType === 'application/x-elysia-2')
					return { name: 'Pardofelis' }
			})
			.post('/json', ({ body }) => body, {
				parse: ['custom', 'custom2']
			})

		const response = await Promise.all([
			app
				.handle(
					new Request('http://localhost:3000/json', {
						method: 'POST',
						headers: {
							'content-type': 'application/json'
						},
						body: JSON.stringify({ name: 'Aru' })
					})
				)
				.then((x) => x.json()),
			app
				.handle(
					new Request('http://localhost:3000/json', {
						method: 'POST',
						headers: {
							'content-type': 'application/x-elysia'
						},
						body: JSON.stringify({ name: 'Aru' })
					})
				)
				.then((x) => x.json()),
			app
				.handle(
					new Request('http://localhost:3000/json', {
						method: 'POST',
						headers: {
							'content-type': 'application/x-elysia-2'
						},
						body: JSON.stringify({ name: 'Aru' })
					})
				)
				.then((x) => x.json())
		])

		expect(response).toEqual([
			{ name: 'Aru' },
			{ name: 'Eden' },
			{ name: 'Pardofelis' }
		])
	})

	it('should get parse error', async () => {
		let code: string | undefined

		const app = new Elysia()
			.onError((ctx) => {
				code = ctx.code
			})
			.post('/', () => '', {
				body: t.Object({
					test: t.String()
				})
			})

		await app.modules

		const response = await app.handle(
			new Request(`http://localhost`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: ''
			})
		)

		expect(code).toBe('PARSE')
		expect(response.status).toBe(400)
	})
})
