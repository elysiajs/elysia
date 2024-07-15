import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import { req } from '../utils'

describe('Normalize', () => {
	it('normalize response', async () => {
		const app = new Elysia({
			normalize: true
		}).get(
			'/',
			() => {
				return {
					hello: 'world',
					a: 'b'
				}
			},
			{
				response: t.Object({
					hello: t.String()
				})
			}
		)

		const response = await app.handle(req('/')).then((x) => x.json())

		expect(response).toEqual({
			hello: 'world'
		})
	})

	it('normalize multiple response', async () => {
		const app = new Elysia({
			normalize: true
		}).get(
			'/',
			({ error }) => error(418, { name: 'Nagisa', hifumi: 'daisuki' }),
			{
				response: {
					200: t.Object({
						hello: t.String()
					}),
					418: t.Object({
						name: t.Literal('Nagisa')
					})
				}
			}
		)

		const response = await app.handle(req('/')).then((x) => x.json())

		expect(response).toEqual({
			name: 'Nagisa'
		})
	})

	it('normalize multiple response using 200', async () => {
		const app = new Elysia({
			normalize: true
		}).get(
			'/',
			() => {
				return {
					hello: 'Nagisa',
					hifumi: 'daisuki'
				}
			},
			{
				response: {
					200: t.Object({
						hello: t.String()
					}),
					418: t.Object({
						name: t.Literal('Nagisa')
					})
				}
			}
		)

		const response = await app.handle(req('/')).then((x) => x.json())

		expect(response).toEqual({
			hello: 'Nagisa'
		})
	})

	it('normalize query', async () => {
		const app = new Elysia({
			normalize: true
		}).get('/', ({ query }) => query, {
			query: t.Object({
				name: t.String()
			})
		})

		const response = await app
			.handle(req('/?name=nagisa&hifumi=daisuki'))
			.then((x) => x.json())

		expect(response).toEqual({
			name: 'nagisa'
		})
	})

	it('do not normalize response when allowing additional properties', async () => {
		const app = new Elysia({
			normalize: true
		}).get(
			'/',
			() => {
				return {
					hello: 'world',
					a: 'b'
				}
			},
			{
				response: t.Object(
					{
						hello: t.String()
					},
					{ additionalProperties: true }
				)
			}
		)

		const response = await app.handle(req('/')).then((x) => x.json())

		expect(response).toEqual({
			hello: 'world',
			a: 'b'
		})
	})

	it('normalize response with getter fields on class', async () => {
		const app = new Elysia({
			normalize: true
		}).get(
			'/',
			() => {
				class MyTest {
					constructor(hello: string) {
						this.one = hello
						this.two = hello
					}
					public one: string
					public two: string

					get oneGet() {
						return this.one
					}

					get twoGet() {
						return this.two
					}
				}

				const res = new MyTest('world')
				return res
			},
			{
				response: t.Object(
					{
						one: t.String(),
						oneGet: t.String()
					},
					{ additionalProperties: false }
				)
			}
		)

		const response = await app.handle(req('/')).then((x) => x.json())

		expect(response).toEqual({
			one: 'world',
			oneGet: 'world'
		})
	})

	it('normalize response with getter fields on simple object', async () => {
		const app = new Elysia({
			normalize: true
		}).get(
			'/',
			() => {
				return {
					one: 'world',
					get oneGet() {
						return 'world'
					},
					two: 'world',
					get twoGet() {
						return 'world'
					}
				}
			},
			{
				response: t.Object(
					{
						one: t.String(),
						oneGet: t.String()
					},
					{ additionalProperties: false }
				)
			}
		)

		const response = await app.handle(req('/')).then((x) => x.json())

		expect(response).toEqual({
			one: 'world',
			oneGet: 'world'
		})
	})
})
