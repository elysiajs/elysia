import { describe, it, expect } from 'bun:test'
import { Elysia, status, t, type AnyElysia } from '../../src'
import { newWebsocket, wsOpen, wsClose, wsClosed, wsMessage } from './utils'
import { req } from '../utils'
import { BunAdapter } from '../../src/adapter/bun'

describe('WebSocket connection', () => {
	it('should connect and close', async () => {
		const app = new Elysia()
			.ws('/ws', {
				message() {}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)
		await wsClosed(ws)
		app.stop()
	})

	it('should close by server', async () => {
		const app = new Elysia()
			.ws('/ws', {
				message(ws) {
					ws.close()
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)

		ws.send('close me!')

		const { wasClean, code } = await wsClose(ws)
		// ws.close() performs the closing handshake, so the closure is clean
		expect(wasClean).toBe(true)
		expect(code).toBe(1000) // normal closure -> https://www.rfc-editor.org/rfc/rfc6455.html#section-7.4.1

		app.stop()
	})

	it('should terminate by server', async () => {
		const app = new Elysia()
			.ws('/ws', {
				message(ws) {
					ws.terminate()
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)

		ws.send('close me!')

		const { wasClean, code } = await wsClose(ws)
		expect(wasClean).toBe(false)
		expect(code).toBe(1006) // closed abnormally -> https://www.rfc-editor.org/rfc/rfc6455.html#section-7.4.1

		app.stop()
	})

	it('should separate get from ws', async () => {
		const app = new Elysia()
			.ws('/ws', {
				message() {}
			})
			.get('/ws', () => 'hi')
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)
		await wsClosed(ws)

		const response = await app.handle(req('/ws')).then((x) => x.text())
		expect(response).toBe('hi')

		app.stop()
	})

	it('should separate all from ws', async () => {
		const app = new Elysia()
			.all('/ws', () => 'hi')
			.ws('/ws', {
				message() {}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		await wsOpen(ws)
		await wsClosed(ws)

		const response = await app.handle(req('/ws')).then((x) => x.text())
		expect(response).toBe('hi')

		app.stop()
	})

	it('should separate dynamic get from ws', async () => {
		const app = new Elysia()
			.ws('/ws/:id', {
				message() {}
			})
			.get('/ws/:id', () => 'hi')
			.listen(0)

		const ws = newWebsocket(app.server!, '/ws/1')

		await wsOpen(ws)
		await wsClosed(ws)

		const response = await app.handle(req('/ws/1')).then((x) => x.text())
		expect(response).toBe('hi')

		app.stop()
	})

	it('should separate dynamic all from ws', async () => {
		const app = new Elysia()
			.all('/ws/:id', () => 'hi')
			.ws('/ws/:id', {
				message() {}
			})
			.listen(0)

		const ws = newWebsocket(app.server!, '/ws/1')

		await wsOpen(ws)
		await wsClosed(ws)

		const response = await app.handle(req('/ws/1')).then((x) => x.text())
		expect(response).toBe('hi')

		app.stop()
	})

	it('handle derive, resolve', async () => {
		let sessionId: string | undefined
		let user: { id: '123'; name: 'Jane Doe' } | undefined

		const app = new Elysia()
			.derive(() => ({
				sessionId: '123'
			}))
			.resolve(() => ({
				getUser() {
					return {
						id: '123',
						name: 'Jane Doe'
					} as const
				}
			}))
			.ws('/ws', {
				open(ws) {
					sessionId = ws.data.sessionId
					user = ws.data.getUser()
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!, '/ws')

		await wsOpen(ws)
		await wsClosed(ws)

		expect(sessionId).toEqual('123')
		expect(user).toEqual({
			id: '123',
			name: 'Jane Doe'
		})
	})

	it('call ping/pong', async () => {
		let pinged = false
		let ponged = false

		const app = new Elysia()
			.ws('/', {
				ping() {
					pinged = true
				},
				pong() {
					ponged = true
				},
				async message(ws) {
				}
			})
			.listen(0)

		const ws = new WebSocket(`ws://localhost:${app.server?.port}`)

		await new Promise<void>((resolve) => {
			ws.addEventListener('open', () => {
				ws.ping()
				ws.send('df')
				ws.pong()

				resolve()
			}, {
				once: true
			})
		})

		await Bun.sleep(3)

		expect(pinged).toBe(true)
		expect(ponged).toBe(true)
	})
})

describe.each([
	['shared adapter', undefined],
	['own adapter', { ...BunAdapter }]
])('WebSocket plugin with %s', (_, adapter) => {
	const plugin = () =>
		new Elysia({
			adapter,
			cookie: { secrets: 'secret', sign: ['session'] }
		})
			.onBeforeHandle(({ cookie: { session } }) => {
				session.value = 'a'

				return status(401)
			})
			.ws('/ws', { message() {} })

	const upgrade = () => req('/ws', { headers: { upgrade: 'websocket' } })

	it('preserve plugin local hook and cookie config', async () => {
		const app = new Elysia().use(plugin())
		const res = await app.handle(upgrade())

		expect(res.status).toBe(401)
		expect(res.headers.get('set-cookie')).toStartWith('session=a.')
	})

	it('preserve plugin local hook and cookie config in async plugin', async () => {
		const app = new Elysia().use(async () => plugin())
		await app.modules

		const res = await app.handle(upgrade())

		expect(res.status).toBe(401)
		expect(res.headers.get('set-cookie')).toStartWith('session=a.')
	})

	it('resolve async plugin model reference', async () => {
		const app = new Elysia().use(async () =>
			new Elysia({ adapter })
				.model('Message', t.String())
				.ws('/ws', { body: 'Message', message() {} })
		)
		await app.modules

		const res = await app.handle(upgrade())

		expect(res.status).toBe(400)
	})

	it('use plugin model over parent model with the same name', async () => {
		const app = new Elysia()
			.model('Message', t.Number())
			.use(
				new Elysia({ adapter }).model('Message', t.String()).ws('/ws', {
					body: 'Message',
					message(ws, message) {
						ws.send(typeof message)
					}
				})
			)
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const message = wsMessage(ws)
		ws.send('hi')

		expect((await message).data).toBe('string')

		await wsClosed(ws)
		app.stop()
	})

	it('use plugin model for nested reference', async () => {
		const app = new Elysia()
			.model({ Child: t.Number() })
			.use(
				new Elysia({ adapter })
					.model({
						Child: t.String(),
						Message: t.Object({ a: t.Ref('Child') })
					})
					.ws('/ws', {
						body: 'Message',
						response: 'Message',
						message(ws, message) {
							ws.send(message)
						}
					})
			)
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const message = wsMessage(ws)
		ws.send(JSON.stringify({ a: 'x' }))

		expect(JSON.parse((await message).data as string)).toEqual({ a: 'x' })

		await wsClosed(ws)
		app.stop()
	})

	it('use plugin model for nested reference in inline schema', async () => {
		const app = new Elysia()
			.model({ Child: t.Number() })
			.use(
				new Elysia({ adapter }).model({ Child: t.String() }).ws('/ws', {
					body: t.Object({ a: t.Ref('Child') }),
					response: t.Object({ a: t.Ref('Child') }),
					message(ws, message) {
						ws.send(message)
					}
				})
			)
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const message = wsMessage(ws)
		ws.send(JSON.stringify({ a: 'x' }))

		expect(JSON.parse((await message).data as string)).toEqual({ a: 'x' })

		await wsClosed(ws)
		app.stop()
	})

	it.each([
		['sync', (p: AnyElysia) => p],
		['async', (p: AnyElysia) => async () => p]
	] as const)('call each %s plugin error handler once', async (_, wrap) => {
		const calls: string[] = []

		const app = new Elysia()
			.use(
				wrap(
					new Elysia({ adapter })
						.onError({ as: 'global' }, () => {
							calls.push('global')
						})
						.onError({ as: 'scoped' }, () => {
							calls.push('scoped')
						})
						.onError(() => {
							calls.push('local')
						})
						.ws('/ws', {
							message() {
								throw new Error('A')
							},
							error() {
								calls.push('ws')
							}
						})
				) as any
			)
			.listen(0)

		await app.modules

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		ws.send('hi')
		await Bun.sleep(50)

		expect(calls.sort()).toEqual(['global', 'local', 'scoped', 'ws'])

		await wsClosed(ws)
		app.stop()
	})

	it.each([
		['sync', (p: AnyElysia) => p],
		['async', (p: AnyElysia) => async () => p]
	] as const)(
		'call %s plugin error handler added after ws',
		async (_, wrap) => {
			const calls: string[] = []

			const app = new Elysia()
				.use(
					wrap(
						new Elysia({ adapter })
							.ws('/ws', {
								message() {
									throw new Error('A')
								}
							})
							.onError(() => {
								calls.push('local')
							})
							.onError({ as: 'global' }, () => {
								calls.push('global')
							})
					) as any
				)
				.listen(0)

			await app.modules

			const ws = newWebsocket(app.server!)
			await wsOpen(ws)

			ws.send('hi')
			await Bun.sleep(50)

			expect(calls.sort()).toEqual(['global', 'local'])

			await wsClosed(ws)
			app.stop()
		}
	)

	it.each([
		['sync', (p: AnyElysia) => p],
		['async', (p: AnyElysia) => async () => p]
	] as const)(
		'call each nested plugin error handler once via %s parent',
		async (_, wrap) => {
			const calls: string[] = []

			const child = new Elysia({ adapter })
				.onError({ as: 'global' }, () => {
					calls.push('global')
				})
				.onError({ as: 'scoped' }, () => {
					calls.push('scoped')
				})
				.ws('/ws', {
					message() {
						throw new Error('A')
					},
					error() {
						calls.push('ws')
					}
				})

			const app = new Elysia()
				.use(
					wrap(
						new Elysia({
							adapter: adapter && { ...BunAdapter }
						}).use(child)
					) as any
				)
				.listen(0)

			await app.modules

			const ws = newWebsocket(app.server!)
			await wsOpen(ws)

			ws.send('hi')
			await Bun.sleep(50)

			expect(calls.sort()).toEqual(['global', 'scoped', 'ws'])

			await wsClosed(ws)
			app.stop()
		}
	)

	it('keep nested plugin error handler when replacing a route', async () => {
		const calls: string[] = []

		const child = new Elysia({ adapter })
			.onError({ as: 'scoped' }, () => {
				calls.push('scoped')
			})
			.ws('/ws', {
				message() {
					throw new Error('A')
				},
				error() {
					calls.push('ws')
				}
			})

		const app = new Elysia()
			.use(
				new Elysia({ adapter: adapter && { ...BunAdapter } })
					.ws('/ws', { message() {} })
					.use(child)
			)
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		ws.send('hi')
		await Bun.sleep(50)

		expect(calls.sort()).toEqual(['scoped', 'ws'])

		await wsClosed(ws)
		app.stop()
	})

	it('call plugin websocket error handler before onError', async () => {
		const app = new Elysia()
			.use(
				new Elysia({ adapter })
					.onError(() => 'fallback')
					.ws('/ws', {
						message() {
							throw new Error('A')
						},
						error() {
							return 'handled'
						}
					})
			)
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const message = wsMessage(ws)
		ws.send('hi')

		expect((await message).data).toBe('handled')

		await wsClosed(ws)
		app.stop()
	})
})

describe('WebSocket plugin with shared adapter', () => {
	const plugin = () =>
		new Elysia()
			.guard({ response: t.Number() })
			.onBeforeHandle(() => 'not a number' as any)
			.ws('/ws', { message() {} })

	const upgrade = () => req('/ws', { headers: { upgrade: 'websocket' } })

	it('preserve plugin response guard', async () => {
		const app = new Elysia().use(plugin())

		expect((await app.handle(upgrade())).status).toBe(422)
	})

	it('preserve plugin response guard in async plugin', async () => {
		const app = new Elysia().use(async () => plugin())
		await app.modules

		expect((await app.handle(upgrade())).status).toBe(422)
	})
})

describe('WebSocket plugin adapter', () => {
	const spy = () => {
		const apps: unknown[] = []

		return {
			apps,
			adapter: {
				...BunAdapter,
				ws(app, path, options) {
					apps.push(app)
					BunAdapter.ws!(app, path, options)
				}
			} satisfies typeof BunAdapter
		}
	}

	it('re-register through parent adapter when plugin has its own', () => {
		const { apps, adapter } = spy()
		const app = new Elysia({ adapter }).use(
			new Elysia().ws('/ws', { message() {} })
		)

		expect(apps).toEqual([app])
	})

	it('copy route when plugin shares the adapter', () => {
		const { apps, adapter } = spy()
		const plugin = new Elysia({ adapter }).ws('/ws', { message() {} })
		new Elysia({ adapter }).use(plugin)

		expect(apps).toEqual([plugin])
	})
})
