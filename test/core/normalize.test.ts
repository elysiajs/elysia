import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import { post, req } from '../utils'

describe('Normalize', () => {
	it('normalize response', async () => {
		const app = new Elysia().get(
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

	it('normalize optional response', async () => {
		const app = new Elysia().get(
			'/',
			() => {
				return {
					hello: 'world',
					a: 'b'
				}
			},
			{
				response: t.Optional(
					t.Object({
						hello: t.String()
					})
				)
			}
		)

		const response = await app.handle(req('/')).then((x) => x.json())

		expect(response).toEqual({
			hello: 'world'
		})
	})

	it('strictly validate response if not normalize', async () => {
		const app = new Elysia({ normalize: false }).get(
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

		const response = await app.handle(req('/'))

		expect(response.status).toEqual(422)
	})

	it('normalize multiple response', async () => {
		const app = new Elysia().get(
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

	it('strictly validate multiple response', async () => {
		const app = new Elysia({
			normalize: false
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

		const response = await app.handle(req('/'))

		expect(response.status).toEqual(422)
	})

	it('normalize multiple response using 200', async () => {
		const app = new Elysia().get(
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

	it('strictly validate multiple response using 200 if not normalize', async () => {
		const app = new Elysia({ normalize: false }).get(
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

		const response = await app.handle(req('/'))

		expect(response.status).toEqual(422)
	})

	it('do not normalize response when allowing additional properties', async () => {
		const app = new Elysia().get(
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

	it('normalize body', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			body: t.Object({
				name: t.String()
			})
		})

		const response = await app
			.handle(
				post('/', {
					name: 'nagisa',
					hifumi: 'daisuki'
				})
			)
			.then((x) => x.json())

		expect(response).toEqual({
			name: 'nagisa'
		})
	})

	it('normalize optional body', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			body: t.Optional(
				t.Object({
					name: t.String()
				})
			)
		})

		const response = await app
			.handle(
				post('/', {
					name: 'nagisa',
					hifumi: 'daisuki'
				})
			)
			.then((x) => x.json())

		expect(response).toEqual({
			name: 'nagisa'
		})
	})

	it('strictly validate body if not normalize', async () => {
		const app = new Elysia({ normalize: false }).post(
			'/',
			({ body }) => body,
			{
				body: t.Object({
					name: t.String()
				})
			}
		)

		const response = await app.handle(
			post('/', {
				name: 'nagisa',
				hifumi: 'daisuki'
			})
		)

		expect(response.status).toBe(422)
	})

	it('loosely validate body if not normalize and has additionalProperties', async () => {
		const app = new Elysia({ normalize: false }).post(
			'/',
			({ body }) => body,
			{
				body: t.Object(
					{
						name: t.String()
					},
					{
						additionalProperties: true
					}
				)
			}
		)

		const response = await app.handle(
			post('/', {
				name: 'nagisa',
				hifumi: 'daisuki'
			})
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({
			name: 'nagisa',
			hifumi: 'daisuki'
		})
	})

	it('normalize query', async () => {
		const app = new Elysia().get('/', ({ query }) => query, {
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

	it("don't normalize query on additionalProperties", async () => {
		const app = new Elysia().get('/', ({ query }) => query, {
			query: t.Object(
				{
					name: t.String()
				},
				{ additionalProperties: true }
			)
		})

		const response = await app
			.handle(req('/?name=nagisa&hifumi=daisuki'))
			.then((x) => x.json())

		expect(response).toEqual({
			name: 'nagisa',
			hifumi: 'daisuki'
		})
	})

	it('normalize based on property when normalized is disabled', async () => {
		const app = new Elysia({ normalize: false }).get(
			'/',
			({ query }) => query,
			{
				query: t.Object(
					{
						name: t.String()
					},
					{
						additionalProperties: true
					}
				)
			}
		)

		const response = await app
			.handle(req('/?name=nagisa&hifumi=daisuki'))
			.then((x) => x.json())

		expect(response).toEqual({
			name: 'nagisa',
			hifumi: 'daisuki'
		})
	})

	it('normalize headers', async () => {
		const app = new Elysia().get('/', ({ headers }) => headers, {
			headers: t.Object({
				name: t.String()
			})
		})

		const response = await app
			.handle(
				req('/', {
					headers: {
						name: 'nagisa',
						hifumi: 'daisuki'
					}
				})
			)
			.then((x) => x.json())

		expect(response).toEqual({
			name: 'nagisa'
		})
	})

	it('loosely validate headers by default if not normalized', async () => {
		const app = new Elysia({ normalize: false }).get(
			'/',
			({ headers }) => headers,
			{
				headers: t.Object({
					name: t.String()
				})
			}
		)

		const headers = {
			name: 'sucrose',
			job: 'alchemist'
		}
		const res = await app.handle(
			req('/', {
				headers
			})
		)

		expect(await res.json()).toEqual(headers)
		expect(res.status).toBe(200)
	})

	it('strictly validate headers if not normalized and additionalProperties is false', async () => {
		const app = new Elysia({ normalize: false }).get(
			'/',
			({ headers }) => headers,
			{
				headers: t.Object(
					{
						name: t.String()
					},
					{
						additionalProperties: false
					}
				)
			}
		)

		const response = await app.handle(
			req('/', {
				headers: {
					name: 'nagisa',
					hifumi: 'daisuki'
				}
			})
		)

		expect(response.status).toBe(422)
	})

	it('response normalization does not mutate', async () => {
		// Long-lived object has a `token` property
		const service = {
			name: 'nagisa',
			status: 'online',
			token: 'secret'
		}

		// ...but this property is hidden by the response schema
		const responseSchema = t.Object({
			name: t.String(),
			status: t.String()
		})

		const app = new Elysia({
			normalize: true
		}).get('/test', () => service, {
			response: responseSchema
		})

		expect(service).toHaveProperty('token')
		const origService = structuredClone(service)

		const response = await app.handle(new Request('http://localhost/test'))
		expect(response.body).not.toHaveProperty('token')

		// Expect the `token` property to remain present after `service` object was used in a response
		expect(service).toHaveProperty('token')

		// In fact, expect the `service` to not be mutated at all
		expect(service).toEqual(origService)
	})

	it('normalize nested schema', async () => {
		const type = t.Array(
			t.Object({
				id: t.String(),
				date: t.Date(),
				name: t.String()
			})
		)
		const date = new Date('2025-07-11T00:00:00.000Z')

		const app = new Elysia().get(
			'/',
			() => {
				return [
					{
						id: 'testId',
						date,
						name: 'testName',
						needNormalize: 'yes'
					}
				]
			},
			{
				response: {
					200: type
				}
			}
		)

		const response = (await app
			.handle(new Request('http://localhost:3000/'))
			.then((x) => x.json())) as typeof type.static

		expect(response).toEqual([
			{
				id: 'testId',
				// @ts-ignore date is normalized to ISO string by default
				date: date.toISOString(),
				name: 'testName'
			}
		])
	})

	it('normalize encodeSchema with Transform', async () => {
		const app = new Elysia().get(
			'/',
			() => ({
				hasMore: true,
				total: 1,
				offset: 0,
				totalPages: 1,
				currentPage: 1,
				items: [{ username: 'Bob', secret: 'shhh' }]
			}),
			{
				// I don't know why but it must be this exact shape
				response: t.Object({
					hasMore: t.Boolean(),
					items: t.Array(
						t.Object({
							username: t.String()
						})
					),
					total: t
						.Transform(t.Number())
						.Decode((x) => x)
						.Encode((x) => x),
					offset: t.Number({ minimum: 0 }),
					totalPages: t.Number(),
					currentPage: t.Number({ minimum: 1 })
				})
			}
		)

		const data = await app.handle(req('/')).then((x) => x.json())

		expect(data).toEqual({
			hasMore: true,
			items: [
				{
					username: 'Bob'
				}
			],
			total: 1,
			offset: 0,
			totalPages: 1,
			currentPage: 1
		})
	})

	// it('normalize response with getter fields on class', async () => {
	// 	const app = new Elysia({
	// 		normalize: true
	// 	}).get(
	// 		'/',
	// 		() => {
	// 			class MyTest {
	// 				constructor(hello: string) {
	// 					this.one = hello
	// 					this.two = hello
	// 				}
	// 				public one: string
	// 				public two: string

	// 				get oneGet() {
	// 					return this.one
	// 				}

	// 				get twoGet() {
	// 					return this.two
	// 				}
	// 			}

	// 			const res = new MyTest('world')
	// 			return res
	// 		},
	// 		{
	// 			response: t.Object(
	// 				{
	// 					one: t.String(),
	// 					oneGet: t.String()
	// 				},
	// 				{ additionalProperties: false }
	// 			)
	// 		}
	// 	)

	// 	const response = await app.handle(req('/')).then((x) => x.json())

	// 	expect(response).toEqual({
	// 		one: 'world',
	// 		oneGet: 'world'
	// 	})
	// })

	// it('normalize response with getter fields on simple object', async () => {
	// 	const app = new Elysia({
	// 		normalize: true
	// 	}).get(
	// 		'/',
	// 		() => {
	// 			return {
	// 				one: 'world',
	// 				get oneGet() {
	// 					return 'world'
	// 				},
	// 				two: 'world',
	// 				get twoGet() {
	// 					return 'world'
	// 				}
	// 			}
	// 		},
	// 		{
	// 			response: t.Object(
	// 				{
	// 					one: t.String(),
	// 					oneGet: t.String()
	// 				},
	// 				{ additionalProperties: false }
	// 			)
	// 		}
	// 	)

	// 	const response = await app.handle(req('/')).then((x) => x.json())

	// 	expect(response).toEqual({
	// 		one: 'world',
	// 		oneGet: 'world'
	// 	})
	// })

	// it('normalize response with getter fields on class array', async () => {
	// 	const app = new Elysia({
	// 		normalize: true
	// 	}).get(
	// 		'/',
	// 		() => {
	// 			class MyTest {
	// 				constructor(hello: string) {
	// 					this.one = hello
	// 					this.two = hello
	// 				}
	// 				public one: string
	// 				public two: string

	// 				get oneGet() {
	// 					return this.one
	// 				}

	// 				get twoGet() {
	// 					return this.two
	// 				}
	// 			}

	// 			const res = new MyTest('world')
	// 			return [res]
	// 		},
	// 		{
	// 			response: t.Array(
	// 				t.Object(
	// 					{
	// 						one: t.String(),
	// 						oneGet: t.String()
	// 					},
	// 					{ additionalProperties: false }
	// 				)
	// 			)
	// 		}
	// 	)

	// 	const response = await app.handle(req('/')).then((x) => x.json())

	// 	expect(response).toEqual([
	// 		{
	// 			one: 'world',
	// 			oneGet: 'world'
	// 		}
	// 	])
	// })

	// it('normalize response with getter fields on simple object array', async () => {
	// 	const app = new Elysia({
	// 		normalize: true
	// 	}).get(
	// 		'/',
	// 		() => {
	// 			return [
	// 				{
	// 					one: 'world',
	// 					get oneGet() {
	// 						return 'world'
	// 					},
	// 					two: 'world',
	// 					get twoGet() {
	// 						return 'world'
	// 					}
	// 				}
	// 			]
	// 		},
	// 		{
	// 			response: t.Array(
	// 				t.Object(
	// 					{
	// 						one: t.String(),
	// 						oneGet: t.String()
	// 					},
	// 					{ additionalProperties: false }
	// 				)
	// 			)
	// 		}
	// 	)

	// 	const response = await app.handle(req('/')).then((x) => x.json())

	// 	expect(response).toEqual([
	// 		{
	// 			one: 'world',
	// 			oneGet: 'world'
	// 		}
	// 	])
	// })

	// it('normalize response with getter fields on class array with nested arrays', async () => {
	// 	const app = new Elysia({
	// 		normalize: true
	// 	}).get(
	// 		'/',
	// 		() => {
	// 			class MyTest {
	// 				constructor(hello: string) {
	// 					this.one = hello
	// 					this.two = hello
	// 				}
	// 				public one: string
	// 				public two: string

	// 				get oneGet() {
	// 					return this.one
	// 				}

	// 				get twoGet() {
	// 					return this.two
	// 				}
	// 			}

	// 			class MyTest2 {
	// 				constructor(hello: string) {
	// 					this.one = hello
	// 					this.two = hello
	// 					this.three = [new MyTest(hello)]
	// 					this.four = [new MyTest(hello)]
	// 				}

	// 				public one: string
	// 				public two: string
	// 				public three: MyTest[]
	// 				public four: MyTest[]

	// 				get oneGet() {
	// 					return this.one
	// 				}

	// 				get twoGet() {
	// 					return this.two
	// 				}

	// 				get threeGet() {
	// 					return this.three
	// 				}

	// 				get fourGet() {
	// 					return this.four
	// 				}
	// 			}

	// 			const res = new MyTest2('world')

	// 			return [res]
	// 		},
	// 		{
	// 			response: t.Array(
	// 				t.Object(
	// 					{
	// 						one: t.String(),
	// 						oneGet: t.String(),
	// 						three: t.Array(
	// 							t.Object(
	// 								{
	// 									one: t.String(),
	// 									oneGet: t.String()
	// 								},
	// 								{ additionalProperties: false }
	// 							)
	// 						),
	// 						threeGet: t.Array(
	// 							t.Object(
	// 								{
	// 									one: t.String(),
	// 									oneGet: t.String()
	// 								},
	// 								{ additionalProperties: false }
	// 							)
	// 						)
	// 					},
	// 					{ additionalProperties: false }
	// 				)
	// 			)
	// 		}
	// 	)

	// 	const response = await app.handle(req('/')).then((x) => x.json())

	// 	expect(response).toEqual([
	// 		{
	// 			one: 'world',
	// 			oneGet: 'world',
	// 			three: [
	// 				{
	// 					one: 'world',
	// 					oneGet: 'world'
	// 				}
	// 			],
	// 			threeGet: [
	// 				{
	// 					one: 'world',
	// 					oneGet: 'world'
	// 				}
	// 			]
	// 		}
	// 	])
	// })

	// it('normalize response with getter fields on simple object array with nested arrays', async () => {
	// 	const app = new Elysia({
	// 		normalize: true
	// 	}).get(
	// 		'/',
	// 		() => {
	// 			const o = [
	// 				{
	// 					one: 'world',
	// 					get oneGet() {
	// 						return 'world'
	// 					},
	// 					two: 'world',
	// 					get twoGet() {
	// 						return 'world'
	// 					}
	// 				}
	// 			]
	// 			return [
	// 				{
	// 					one: 'world',
	// 					get oneGet() {
	// 						return 'world'
	// 					},
	// 					two: 'world',
	// 					get twoGet() {
	// 						return 'world'
	// 					},
	// 					three: o,
	// 					get threeGet() {
	// 						return o
	// 					},
	// 					four: o,
	// 					get fourGet() {
	// 						return o
	// 					}
	// 				}
	// 			]
	// 		},
	// 		{
	// 			response: t.Array(
	// 				t.Object(
	// 					{
	// 						one: t.String(),
	// 						oneGet: t.String(),
	// 						three: t.Array(
	// 							t.Object(
	// 								{
	// 									one: t.String(),
	// 									oneGet: t.String()
	// 								},
	// 								{ additionalProperties: false }
	// 							)
	// 						),
	// 						threeGet: t.Array(
	// 							t.Object(
	// 								{
	// 									one: t.String(),
	// 									oneGet: t.String()
	// 								},
	// 								{ additionalProperties: false }
	// 							)
	// 						)
	// 					},
	// 					{ additionalProperties: false }
	// 				)
	// 			)
	// 		}
	// 	)

	// 	const response = await app.handle(req('/')).then((x) => x.json())

	// 	expect(response).toEqual([
	// 		{
	// 			one: 'world',
	// 			oneGet: 'world',
	// 			three: [
	// 				{
	// 					one: 'world',
	// 					oneGet: 'world'
	// 				}
	// 			],
	// 			threeGet: [
	// 				{
	// 					one: 'world',
	// 					oneGet: 'world'
	// 				}
	// 			]
	// 		}
	// 	])
	// })

	// it('normalize getter field', async () => {
	// 	class Example {
	// 		field1: string
	// 		field3?: string

	// 		constructor(
	// 			private field2: string,
	// 			field1: string,
	// 			field3?: string
	// 		) {
	// 			this.field1 = field1
	// 			this.field3 = field3
	// 		}

	// 		get getterField() {
	// 			return this.field2
	// 		}
	// 	}

	// 	const app = new Elysia().get(
	// 		'/',
	// 		() => new Example('field2', 'field1'),
	// 		{
	// 			response: t.Object({
	// 				field1: t.String(),
	// 				field3: t.Optional(t.String()),
	// 				getterField: t.String()
	// 			})
	// 		}
	// 	)

	// 	const response = await app.handle(req('/')).then((x) => x.json())

	// 	expect(response).toEqual({
	// 		field1: 'field1',
	// 		getterField: 'field2'
	// 	})
	// })
})
