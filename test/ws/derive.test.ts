import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'
import { websocket } from '../../src/plugin/websocket'
import { newWebsocket, wsOpen, wsMessage, wsClosed } from './utils'

// Run each route twice to verify derived state remains available on later upgrades.
const expectDerived = async (server: any, value: string) => {
	const ws = newWebsocket(server)
	await wsOpen(ws)
	const msg = wsMessage(ws)
	ws.send('ping')
	const { data } = await msg
	expect(data).toBe(value)
	await wsClosed(ws)
}

describe('WebSocket derive', () => {
	it('derive survives a second upgrade to the same route', async () => {
		const app = new Elysia()
			.derive(() => ({ user: 'alice' }))
			.use(websocket())
			.ws('/ws', {
				message(ws: any) {
					ws.send(ws.user)
				}
			})
			.listen(0)

		await expectDerived(app.server!, 'alice')
		await expectDerived(app.server!, 'alice')

		app.stop()
	})

	it('mapDerive survives a second upgrade to the same route', async () => {
		const app = new Elysia()
			.mapDerive(() => ({ user: 'bob' }))
			.use(websocket())
			.ws('/ws', {
				message(ws: any) {
					ws.send(ws.user)
				}
			})
			.listen(0)

		await expectDerived(app.server!, 'bob')
		await expectDerived(app.server!, 'bob')

		app.stop()
	})

	// the upgrade hooks see the derive result, then the context is copied onto
	// the socket once per connection; a `for..in` copy skips symbol keys, so a
	// symbol-keyed value vanished before the first message. An own `__proto__`
	// must still land as inert data, not reparent the socket
	for (const lane of ['derive', 'mapDerive'] as const)
		it(`${lane} exposes symbol keys to the message handler`, async () => {
			const key = Symbol('key')
			const app = new Elysia()
				[lane](() =>
					Object.assign(
						JSON.parse('{"__proto__":{"isAdmin":true}}'),
						{
							[key]: 'symbol',
							user: 'alice'
						}
					)
				)
				.use(websocket())
				.ws('/ws', {
					message(ws: any) {
						ws.send(
							JSON.stringify([
								ws[key],
								ws.user,
								ws.isAdmin ?? null,
								typeof ws.send
							])
						)
					}
				})
				.listen(0)

			await expectDerived(
				app.server!,
				JSON.stringify(['symbol', 'alice', null, 'function'])
			)

			app.stop()
		})
})

// a derive value with Symbol.dispose is request-owned on HTTP and released
// after the response; on WS the connection owns it once the upgrade succeeds,
// so it is released after close, when no message can still use it
describe('WebSocket derive dispose', () => {
	const disposable = (log: string[], name: string) => ({
		name,
		[Symbol.dispose]() {
			log.push(name)
		}
	})
	const upgrade = (app: any, path = '/ws') =>
		app.handle(
			new Request(`http://localhost${path}`, {
				headers: { upgrade: 'websocket' }
			})
		)

	it('disposes once when the upgrade is refused', async () => {
		const log: string[] = []
		const app = new Elysia()
			.derive(() => ({ res: disposable(log, 'res') }))
			.use(websocket())
			.ws('/denied', {
				beforeHandle: () => 'denied',
				message() {}
			})
			.ws('/thrown', {
				beforeHandle() {
					throw new Error('boom')
				},
				message() {}
			})

		expect((await upgrade(app, '/denied')).status).toBe(200)
		expect((await upgrade(app, '/thrown')).status).toBe(500)
		await Bun.sleep(1)

		expect(log).toEqual(['res', 'res'])
	})

	// registered as HTTP registers them: the result is read once, so the
	// instance registered is the one the context exposes; an instance under
	// two keys is registered once; a symbol key counts
	it('registers derive values as HTTP does', async () => {
		const marker = Symbol('resource')
		const log: string[] = []
		const seen: string[] = []
		const shared = disposable(log, 'shared')
		let reads = 0
		const derive = () => {
			const value: any = {
				a: shared,
				b: shared,
				[marker]: disposable(log, 'symbol')
			}
			Object.defineProperty(value, 'getter', {
				enumerable: true,
				get: () => disposable(log, `getter-${++reads}`)
			})

			return value
		}
		const look = (context: any) => {
			seen.push(
				`${context.a === shared}:${context.getter.name}:${context[marker].name}`
			)
		}

		const http = new Elysia().derive(derive).get('/h', (context: any) => {
			look(context)

			return 'ok'
		})
		await http.handle(new Request('http://localhost/h'))
		await Bun.sleep(1)

		const app = new Elysia()
			.derive(derive)
			.use(websocket())
			.ws('/ws', {
				beforeHandle(context: any) {
					look(context)

					return 'denied'
				},
				message() {}
			})
		await upgrade(app)
		await Bun.sleep(1)

		expect(seen).toEqual(['true:getter-1:symbol', 'true:getter-2:symbol'])
		expect(log).toEqual([
			'symbol',
			'getter-1',
			'shared',
			'symbol',
			'getter-2',
			'shared'
		])
	})

	// mapDerive registers against the pre-swap context, which holds neither
	// an alias nor a key `Object.keys` skips: the shared instance was released
	// twice and the symbol-keyed one never
	it('registers mapDerive values as HTTP does', async () => {
		const marker = Symbol('resource')
		const carried = Symbol('carried')
		const log: string[] = []
		const shared = disposable(log, 'shared')

		const app = new Elysia()
			.derive(() => ({ [carried]: disposable(log, 'carried') }))
			.mapDerive((context) => ({
				...context,
				a: shared,
				b: shared,
				[marker]: disposable(log, 'symbol')
			}))
			.use(websocket())
			.ws('/ws', { message() {} })
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)
		await wsClosed(ws)
		await Bun.sleep(30)

		expect(log).toEqual(['symbol', 'shared', 'carried'])

		app.stop()
	})

	it('keeps the value while a message is in flight and disposes once after close', async () => {
		const log: string[] = []
		const app = new Elysia()
			.derive(() => ({ res: disposable(log, 'res') }))
			.use(websocket())
			.ws('/ws', {
				async message(ws: any) {
					await Bun.sleep(30)
					return ws.res.name
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)

		const reply = wsMessage(ws)
		ws.send('x')
		expect((await reply).data).toBe('res')
		expect(log).toEqual([])

		// close while a second message is still running
		ws.send('x')
		await Bun.sleep(5)
		await wsClosed(ws)
		expect(log).toEqual([])

		await Bun.sleep(50)
		expect(log).toEqual(['res'])

		app.stop()
	})

	it('awaits Symbol.asyncDispose and survives a disposer that throws', async () => {
		const log: string[] = []
		let closed = false
		const app = new Elysia()
			.derive(() => ({
				db: {
					[Symbol.dispose]() {
						log.push('sync')
					},
					async [Symbol.asyncDispose]() {
						await Bun.sleep(5)
						log.push('async')
					}
				},
				bad: {
					[Symbol.dispose]() {
						throw new Error('dispose failed')
					}
				}
			}))
			.use(websocket())
			.ws('/ws', {
				message() {},
				close() {
					closed = true
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)
		await wsOpen(ws)
		await wsClosed(ws)
		await Bun.sleep(30)

		expect(closed).toBe(true)
		expect(log).toEqual(['async'])

		app.stop()
	})
})
