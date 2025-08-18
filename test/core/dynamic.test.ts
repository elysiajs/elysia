import { Elysia, NotFoundError, status, t } from '../../src'

import { describe, expect, it } from 'bun:test'
import { post, req } from '../utils'

describe('Dynamic Mode', () => {
	it('handle path', async () => {
		const app = new Elysia({
			aot: false
		}).get('/', () => 'Hi')

		const res = await app.handle(req('/')).then((x) => x.text())
		expect(res).toBe('Hi')
	})

	it('handle literal', async () => {
		const app = new Elysia({ aot: false }).get('/', 'Hi')

		const response = await app.handle(req('/')).then((x) => x.text())

		expect(response).toBe('Hi')
	})

	it('handle body', async () => {
		const app = new Elysia({
			aot: false
		}).post('/', ({ body }) => body, {
			body: t.Object({
				name: t.String()
			})
		})

		const body = {
			name: 'saltyaom'
		} as const

		const res = (await app
			.handle(post('/', body))
			.then((x) => x.json())) as typeof body

		const invalid = await app.handle(post('/', {})).then((x) => x.status)

		expect(res.name).toBe(body.name)
		expect(invalid).toBe(422)
	})

	it('handle dynamic all method', async () => {
		const app = new Elysia({
			aot: false
		}).all('/all/*', () => 'ALL')

		const res = await app.handle(req('/all/world')).then((x) => x.text())
		expect(res).toBe('ALL')
	})

	it('inherits plugin', async () => {
		const plugin = new Elysia().decorate('hi', () => 'hi')

		const app = new Elysia({
			aot: false
		})
			.use(plugin)
			.get('/', ({ hi }) => hi())

		const res = await app.handle(req('/')).then((r) => r.text())
		expect(res).toBe('hi')
	})

	it('use custom error', async () => {
		const res = await new Elysia({
			aot: false
		})
			.get('/', () => 'Hi')
			.onError(({ code }) => {
				if (code === 'NOT_FOUND')
					return new Response("I'm a teapot", {
						status: 418
					})
			})
			.handle(req('/not-found'))

		expect(await res.text()).toBe("I'm a teapot")
		expect(res.status).toBe(418)
	})

	it('inject headers to error', async () => {
		const app = new Elysia({
			aot: false
		})
			.onRequest(({ set }) => {
				set.headers['Access-Control-Allow-Origin'] = '*'
			})
			.get('/', () => {
				throw new NotFoundError()
			})

		const res = await app.handle(req('/'))

		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
		expect(res.status).toBe(404)
	})

	it('transform any to error', async () => {
		const app = new Elysia({
			aot: false
		})
			.get('/', () => {
				throw new NotFoundError()
			})
			.onError(async ({ set }) => {
				set.status = 418

				return 'aw man'
			})

		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('aw man')
		expect(res.status).toBe(418)
	})

	it('derive', async () => {
		const app = new Elysia({
			aot: false
		})
			.derive(() => {
				return {
					A: 'A'
				}
			})
			.get('/', ({ A }) => A)

		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('A')
		expect(res.status).toBe(200)
	})

	it('resolve', async () => {
		const app = new Elysia({ aot: false })
			.resolve(() => {
				return {
					hello: 'Sunday'
				}
			})
			.get('/', ({ hello }) => hello)

		const res = await app.handle(req('/'))

		expect(await res.text()).toBe('Sunday')
		expect(res.status).toBe(200)
	})

	it('validate', async () => {
		const app = new Elysia({ aot: false }).post(
			'/',
			({ query: { id, arr } }) => `${id} - ${arr}`,
			{
				body: t.Object({
					username: t.String(),
					password: t.String()
				}),
				query: t.Object({
					id: t.String(),
					arr: t.Array(t.String())
				}),
				response: {
					200: t.String()
				}
			}
		)

		const res = await app
			.handle(
				post('/?id=me&arr=v1&arr=v2', {
					username: 'username',
					password: 'password'
				})
			)
			.then((x) => x.text())

		expect(res).toBe('me - v1,v2')
	})

	it('default value', async () => {
		const app = new Elysia({ aot: false }).get(
			'/:propParams?',
			({
				params: { propParams },
				headers: { propHeader },
				query: { propQuery }
			}) => `${propParams} ${propHeader} ${propQuery}`,
			{
				params: t.Object({
					propParams: t.String({
						default: 'params-default'
					})
				}),
				headers: t.Object({
					propHeader: t.String({
						default: 'header-default'
					})
				}),
				query: t.Object({
					propQuery: t.String({
						default: 'query-default'
					})
				})
			}
		)

		const response = await app
			.handle(new Request('http://localhost'))
			.then((x) => x.text())

		expect(response).toBe('params-default header-default query-default')
	})

	it('handle non query fallback', async () => {
		const app = new Elysia({ aot: false }).get('/', () => 'hi', {
			query: t.Object({
				redirect_uri: t.Optional(t.String())
			})
		})

		const res1 = await app.handle(req('/'))
		const res2 = await app.handle(req('/?'))
		const res3 = await app.handle(req('/?redirect_uri=a'))

		expect(res1.status).toBe(200)
		expect(res2.status).toBe(200)
		expect(res3.status).toBe(200)
	})

	it('handle local parse event', async () => {
		const app = new Elysia({ aot: false }).post('/', (ctx) => ctx.body, {
			parse: (ctx, contentType) => {
				return contentType
			},
			body: t.String()
		})

		const res = await app.handle(
			new Request('http://localhost', {
				method: 'POST',
				body: 'yay',
				headers: { 'content-type': 'text/plain' }
			})
		)

		expect(await res.text()).toBe('text/plain')
	})

	it('handle async resolve', async () => {
		const app = new Elysia({ aot: false })
			.resolve(() => status(418, 'Chocominto yorimo anata!'))
			.post('/ruby-chan', () => 'Hai!')

		const res = await app.handle(post('/ruby-chan', 'nani ga suki!'))

		expect(await res.text()).toBe('Chocominto yorimo anata!')
		expect(res.status).toBe(418)
	})

	it('set default header', async () => {
		const app = new Elysia({ aot: false })
			.headers({
				'X-Powered-By': 'Elysia'
			})
			.get('/', () => 'Hello')

		const res = await app.handle(req('/'))

		expect(res.headers.get('X-Powered-By')).toBe('Elysia')
	})

	it('handle local cookie signing', async () => {
		const app = new Elysia({
			aot: false
		}).get(
			'/',
			({ cookie: { profile } }) => {
				profile.value = {
					id: 617,
					name: 'Summoning 101'
				}

				return profile.value
			},
			{
				cookie: t.Cookie(
					{
						profile: t.Optional(
							t.Object({
								id: t.Numeric(),
								name: t.String()
							})
						)
					},
					{
						secrets: 'Fischl von Luftschloss Narfidort',
						sign: ['profile']
					}
				)
			}
		)

		const response = await app.handle(req('/')).then((x) => x.json())

		expect(response).toEqual({
			id: 617,
			name: 'Summoning 101'
		})
	})

	it('handle global cookie signing', async () => {
		const app = new Elysia({
			aot: false,
			cookie: {
				secrets: 'Fischl von Luftschloss Narfidort',
				sign: ['profile']
			}
		}).get(
			'/',
			({ cookie: { profile } }) => {
				profile.value = {
					id: 617,
					name: 'Summoning 101'
				}

				return profile.value
			},
			{
				cookie: t.Cookie({
					profile: t.Optional(
						t.Object({
							id: t.Numeric(),
							name: t.String()
						})
					)
				})
			}
		)

		const response = await app.handle(req('/')).then((x) => x.json())

		expect(response).toEqual({
			id: 617,
			name: 'Summoning 101'
		})
	})

	it('handle optional cookie', async () => {
		const app = new Elysia({
			aot: false
		}).get(
			'/',
			({ cookie: { profile } }) => {
				profile.value = {
					id: 617,
					name: 'Summoning 101'
				}

				return profile.value
			},
			{
				cookie: t.Optional(
					t.Cookie(
						{
							profile: t.Optional(
								t.Object({
									id: t.Numeric(),
									name: t.String()
								})
							)
						},
						{
							secrets: 'Fischl von Luftschloss Narfidort',
							sign: ['profile']
						}
					)
				)
			}
		)

		const response = await app.handle(req('/')).then((x) => x.json())

		expect(response).toEqual({
			id: 617,
			name: 'Summoning 101'
		})
	})

	it('use built-in name parser (text)', async () => {
		const app = new Elysia({ aot: false }).post(
			'/',
			({ body }) => typeof body,
			{
				parse: 'text'
			}
		)

		const response = await app
			.handle(
				new Request('http://localhost', {
					method: 'POST',
					headers: {
						'content-type': 'application/json'
					},
					body: JSON.stringify({ hello: 'world' })
				})
			)
			.then((x) => x.text())

		expect(response).toBe('string')
	})

	it('use built-in name parser (text/plain)', async () => {
		const app = new Elysia({ aot: false }).post(
			'/',
			({ body }) => typeof body,
			{
				parse: 'text/plain'
			}
		)

		const response = await app
			.handle(
				new Request('http://localhost', {
					method: 'POST',
					headers: {
						'content-type': 'application/json'
					},
					body: JSON.stringify({ hello: 'world' })
				})
			)
			.then((x) => x.text())

		expect(response).toBe('string')
	})

	it('use built-in name parser (json)', async () => {
		const app = new Elysia({ aot: false }).post(
			'/',
			({ body }) => typeof body,
			{
				parse: 'json'
			}
		)

		const response = await app
			.handle(
				new Request('http://localhost', {
					method: 'POST',
					headers: {
						'content-type': 'text/plain'
					},
					body: JSON.stringify({ hello: 'world' })
				})
			)
			.then((x) => x.text())

		expect(response).toBe('object')
	})

	it('use custom name parser', async () => {
		const app = new Elysia({ aot: false })
			.parser('thing', () => {
				return true
			})
			.post('/', ({ body }) => typeof body, {
				parse: 'thing'
			})

		const response = await app
			.handle(
				new Request('http://localhost', {
					method: 'POST',
					headers: {
						'content-type': 'text/plain'
					},
					body: JSON.stringify({ hello: 'world' })
				})
			)
			.then((x) => x.text())

		expect(response).toBe('boolean')
	})

	it('validate response', async () => {
		const app = new Elysia({ aot: false })
			// @ts-ignore
			.get('/invalid', () => ({ name: 'Jane Doe' }), {
				response: t.Object({
					foo: t.String()
				})
			})
			.get(
				'/invalid-201',
				// @ts-ignore
				({ status }) => status(201, { name: 'Jane Doe' }),
				{
					response: {
						201: t.Object({
							foo: t.String()
						})
					}
				}
			)
			.get('/valid', () => ({ foo: 'bar' }), {
				response: t.Object({
					foo: t.String()
				})
			})
			.get('/valid-201', ({ status }) => status(201, { foo: 'bar' }), {
				response: {
					201: t.Object({
						foo: t.String()
					})
				}
			})

		const invalid = await app.handle(req('/invalid')).then((x) => x.status)
		const invalid201 = await app
			.handle(req('/invalid-201'))
			.then((x) => x.status)
		const valid = await app.handle(req('/valid')).then((x) => x.status)
		const valid201 = await app
			.handle(req('/valid-201'))
			.then((x) => x.status)

		expect(invalid).toBe(422)
		expect(invalid201).toBe(422)
		expect(valid).toBe(200)
		expect(valid201).toBe(201)
	})

	it('clean response', async () => {
		const app = new Elysia({ aot: false })
			// @ts-ignore
			.get('/invalid', () => ({ name: 'Jane Doe' }), {
				response: t.Object({
					foo: t.String()
				})
			})
			.get('/valid', () => ({ foo: 'bar', a: 'b' }), {
				response: t.Object({
					foo: t.String()
				})
			})

		const invalid = await app.handle(req('/invalid')).then((x) => x.status)
		const valid = await app.handle(req('/valid')).then((x) => x.json())

		expect(invalid).toBe(422)
		expect(valid).toEqual({
			foo: 'bar'
		})
	})

	it('validate after handle', async () => {
		const app = new Elysia({ aot: false })
			// @ts-ignore
			.get('/invalid', () => '', {
				afterHandle: () => ({ name: 'Jane Doe' }),
				response: t.Object({
					foo: t.String()
				})
			})
			.get(
				'/invalid-201',
				// @ts-ignore
				() => '',
				{
					// @ts-ignore
					afterHandle: ({ status }) =>
						// @ts-ignore
						status(201, { name: 'Jane Doe' }),
					response: {
						201: t.Object({
							foo: t.String()
						})
					}
				}
			)
			// @ts-ignore
			.get('/valid', () => '', {
				afterHandle: () => ({ foo: 'bar' }),
				response: t.Object({
					foo: t.String()
				})
			})
			.get('/valid-201', () => '', {
				afterHandle: ({ status }) => status(201, { foo: 'bar' }),
				response: {
					201: t.Object({
						foo: t.String()
					})
				}
			})

		const invalid = await app.handle(req('/invalid')).then((x) => x.status)
		const invalid201 = await app
			.handle(req('/invalid-201'))
			.then((x) => x.status)
		const valid = await app.handle(req('/valid')).then((x) => x.status)
		const valid201 = await app
			.handle(req('/valid-201'))
			.then((x) => x.status)

		expect(invalid).toBe(422)
		expect(invalid201).toBe(422)
		expect(valid).toBe(200)
		expect(valid201).toBe(201)
	})

	it('clean afterHandle', async () => {
		const app = new Elysia({ aot: false })
			// @ts-ignore
			.get('/invalid', () => '', {
				afterHandle: () => ({ name: 'Jane Doe' }),
				response: t.Object({
					foo: t.String()
				})
			})
			// @ts-ignore
			.get('/valid', () => '', {
				afterHandle: () => ({ foo: 'bar', a: 'b' }),
				response: t.Object({
					foo: t.String()
				})
			})

		const invalid = await app.handle(req('/invalid')).then((x) => x.status)
		const valid = await app.handle(req('/valid')).then((x) => x.json())

		expect(invalid).toBe(422)
		expect(valid).toEqual({
			foo: 'bar'
		})
	})

	it('handle single query array', async () => {
		const app = new Elysia({ aot: false }).get('/', ({ query }) => query, {
			query: t.Object({
				name: t.String(),
				names: t.Array(t.String())
			})
		})

		const data = await app
			.handle(req('/?name=neon&names=rapi'))
			.then((x) => x.json())

		expect(data).toEqual({
			name: 'neon',
			names: ['rapi']
		})
	})

	it('handle multiple query array in nuqs format', async () => {
		const app = new Elysia({ aot: false }).get('/', ({ query }) => query, {
			query: t.Object({
				name: t.String(),
				names: t.Array(t.String())
			})
		})

		const data = await app
			.handle(req('/?name=neon&names=rapi,anis'))
			.then((x) => x.json())

		expect(data).toEqual({
			name: 'neon',
			names: ['rapi', 'anis']
		})
	})

	it('handle multiple query array in nuqs format', async () => {
		const app = new Elysia({ aot: false }).get('/', ({ query }) => query, {
			query: t.Object({
				name: t.String(),
				names: t.Array(t.String())
			})
		})

		const data = await app
			.handle(req('/?name=neon&names=rapi,anis'))
			.then((x) => x.json())

		expect(data).toEqual({
			name: 'neon',
			names: ['rapi', 'anis']
		})
	})

	it('handle query array reference in multiple reference format', async () => {
		const IdsModel = new Elysia().model({
			name: t.Object({
				name: t.Array(t.String())
			})
		})

		const app = new Elysia({ aot: false })
			.use(IdsModel)
			.get('/', ({ query }) => query, {
				name: 'ids'
			})

		const data = await app
			.handle(req('/?names=rapi&names=anis'))
			.then((x) => x.json())

		expect(data).toEqual({
			names: ['rapi', 'anis']
		})
	})

	it('handle query array reference in multiple reference format', async () => {
		const IdsModel = new Elysia().model({
			name: t.Object({
				name: t.Array(t.String())
			})
		})

		const app = new Elysia({ aot: false })
			.use(IdsModel)
			.get('/', ({ query }) => query, {
				name: 'ids'
			})

		const data = await app
			.handle(req('/?names=rapi&names=anis'))
			.then((x) => x.json())

		expect(data).toEqual({
			names: ['rapi', 'anis']
		})
	})
})
