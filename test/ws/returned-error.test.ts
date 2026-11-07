import { describe, it, expect } from 'bun:test'
import { Elysia, HTTPError, status, t } from '../../src'
import { websocket } from '../../src/plugin/websocket'
import { newWebsocket, wsOpen, wsClose, wsClosed, wsMessage } from './utils'

// A WebSocket hook or handler that returns an error answers as if it threw
// it, as on HTTP: the error hooks see it and the client gets its problem
// frame, never the instance framed as data (nor a "must be string" from the
// response schema checking it as one)

class OutOfCredit extends HTTPError<'OUT_OF_CREDIT'> {
	type = 'OUT_OF_CREDIT' as const
	override readonly status = 402
	override readonly detail = 'Out of credit'
}

// an Error with its own `then`: classified before it can be assimilated into
// the 'data' it resolves to, as on HTTP
class Thenable extends Error {
	then(resolve: (value: unknown) => void) {
		resolve('data')
	}
}

// classified before its `then` is read: the getter's throw never replaces it
class GetterThen extends Error {
	get then() {
		throw new Error('getter')
	}
}

const within = <T>(promise: Promise<T>, what: string, ms = 2000) => {
	let timer: ReturnType<typeof setTimeout> | undefined

	return Promise.race([
		promise,
		new Promise<never>((_, reject) => {
			timer = setTimeout(
				() => reject(new Error(`${what} did not happen in ${ms}ms`)),
				ms
			)
		})
	]).finally(() => clearTimeout(timer))
}

type Fire = () => unknown

interface Path {
	options(fire: Fire): Record<string, unknown>
	// what makes the server reach the path once the socket is open
	trigger?(ws: WebSocket): void
}

const paths: Record<string, Path> = {
	'per-message beforeHandle': {
		options: (fire) => ({
			// it runs at the upgrade too, with no body
			beforeHandle({ body }: any) {
				if (body !== undefined) return fire()
			},
			message() {}
		}),
		trigger: (ws) => ws.send('x')
	},
	'message, sync lane': {
		options: (fire) => ({ message: () => fire() }),
		trigger: (ws) => ws.send('x')
	},
	'message, full lane': {
		options: (fire) => ({ transform() {}, message: () => fire() }),
		trigger: (ws) => ws.send('x')
	},
	'message, afterResponse lane': {
		options: (fire) => ({ afterResponse() {}, message: () => fire() }),
		trigger: (ws) => ws.send('x')
	},
	open: {
		options: (fire) => ({ open: () => fire(), message() {} })
	},
	ping: {
		options: (fire) => ({ ping: () => fire(), message() {} }),
		trigger: (ws) => (ws as any).ping()
	},
	pong: {
		options: (fire) => ({
			open(ws: any) {
				ws.ping()
			},
			pong: () => fire(),
			message() {}
		})
	},
	// the server closes: the close callback's frame is sent before closure
	'close, server-initiated': {
		options: (fire) => ({
			message(ws: any) {
				ws.close()
			},
			close: () => fire()
		}),
		trigger: (ws) => ws.send('x')
	}
}

const errors = {
	OutOfCredit: () => new OutOfCredit(),
	Thenable: () => new Thenable('thenable'),
	GetterThen: () => new GetterThen('original')
}

async function answer(
	path: Path,
	error: Error,
	mode: 'return' | 'throw',
	async: boolean
): Promise<{ frame: unknown; seen: unknown[] }> {
	const seen: unknown[] = []
	const settle = () => {
		if (mode === 'throw') throw error
		return error
	}
	const fire = async ? async () => settle() : settle

	const app = new Elysia()
		.use(websocket())
		.onError(({ error }) => {
			seen.push(error)
		})
		.ws('/ws', { response: t.String(), ...path.options(fire) } as any)
		.listen(0)

	const ws = newWebsocket(app.server!)

	try {
		// listening before the socket opens: `open` answers right away
		const message = wsMessage(ws)
		await wsOpen(ws)
		path.trigger?.(ws)

		const { data } = await within(message, 'a frame')

		return { frame: data, seen }
	} finally {
		if (ws.readyState === WebSocket.OPEN) await wsClosed(ws)
		app.stop(true)
	}
}

describe('WebSocket returned error answers as a thrown one', () => {
	for (const [name, path] of Object.entries(paths))
		for (const [kind, make] of Object.entries(errors))
			for (const async of [false, true]) {
				// an async function assimilates a returned thenable itself
				if (async && kind !== 'OutOfCredit') continue

				it(`${name}${async ? ', async' : ''}: a returned ${kind} = a thrown one`, async () => {
					const returnedError = make()
					const thrownError = make()

					const returned = await answer(
						path,
						returnedError,
						'return',
						async
					)
					const thrown = await answer(
						path,
						thrownError,
						'throw',
						async
					)

					expect(returned.frame).toBe(thrown.frame as string)
					expect(returned.seen).toEqual([returnedError])
					expect(returned.seen[0]).toBe(returnedError)
					expect(thrown.seen[0]).toBe(thrownError)

					if (kind === 'OutOfCredit')
						expect(
							JSON.parse(returned.frame as string)
						).toMatchObject({
							type: 'OUT_OF_CREDIT',
							status: 402,
							title: 'Payment Required',
							detail: 'Out of credit'
						})
					else
						expect(returned.frame).not.toContain(
							kind === 'Thenable' ? 'data' : 'getter'
						)
				})
			}

	it('closes after the frame on a server-initiated close', async () => {
		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				message(ws) {
					ws.close()
				},
				close: () => new OutOfCredit()
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		try {
			const message = wsMessage(ws)
			const closed = wsClose(ws)
			await wsOpen(ws)
			ws.send('x')

			const { data } = await within(message, 'the close frame')
			// the problem frame, not the instance framed as data
			expect(JSON.parse(data as string)).toMatchObject({
				type: 'OUT_OF_CREDIT',
				status: 402,
				title: 'Payment Required'
			})

			await within(closed, 'the closure')
		} finally {
			app.stop(true)
		}
	})
})

describe('WebSocket returned error of a class registered with .onError(Class)', () => {
	// not an Error: only its registration makes it one
	class Credit {
		amount = 1
	}

	// a native Promise too: classified before it is awaited
	class Pending extends Promise<string> {}

	const classes = {
		Credit: () => new Credit(),
		Pending: () => new Pending((resolve) => resolve('data'))
	}

	for (const [name, path] of Object.entries({
		'per-message beforeHandle': paths['per-message beforeHandle'],
		'message, sync lane': paths['message, sync lane'],
		'message, full lane': paths['message, full lane'],
		open: paths.open
	}))
		for (const [kind, make] of Object.entries(classes))
			it(`${name}: a returned ${kind} = a thrown one`, async () => {
				const run = async (mode: 'return' | 'throw') => {
					const seen: unknown[] = []
					const credit = make()

					const app = new Elysia()
						.use(websocket())
						.onError(
							credit.constructor as any,
							({ error }: any) => {
								seen.push(error)
								return status(418, 'caught')
							}
						)
						.ws(
							'/ws',
							path.options(() => {
								if (mode === 'throw') throw credit
								return credit
							}) as any
						)
						.listen(0)

					const ws = newWebsocket(app.server!)

					try {
						const message = wsMessage(ws)
						await wsOpen(ws)
						path.trigger?.(ws)

						const { data } = await within(message, 'a frame')

						expect(seen).toEqual([credit])

						return data
					} finally {
						if (ws.readyState === WebSocket.OPEN) await wsClosed(ws)
						app.stop(true)
					}
				}

				const returned = await run('return')

				expect(returned).toBe((await run('throw')) as string)
				expect(JSON.parse(returned as string)).toEqual({
					status: 418,
					error: 'caught'
				})
			})
})

describe('WebSocket upgrade returned error', () => {
	// the upgrade lane already threw a returned error: a thenable one too
	it('refuses the upgrade for a returned thenable error as for a thrown one', async () => {
		const run = async (mode: 'return' | 'throw') => {
			const seen: unknown[] = []
			const error = new Thenable('thenable')

			const app = new Elysia()
				.use(websocket())
				.onError(({ error }) => {
					seen.push(error)
				})
				.ws('/ws', {
					beforeHandle() {
						if (mode === 'throw') throw error
						return error
					},
					message() {}
				})

			const response = await app.handle(
				new Request('http://localhost/ws', {
					headers: { upgrade: 'websocket' }
				})
			)

			expect(seen).toEqual([error])

			return [response.status, await response.text()]
		}

		const returned = await run('return')

		expect(returned).toEqual(await run('throw'))
		expect(returned[0]).toBe(500)
	})
})

describe('WebSocket returned error hook order', () => {
	it('skips afterHandle after a beforeHandle-returned error, as after a throw', async () => {
		const ran: string[] = []

		const app = new Elysia()
			.use(websocket())
			.ws('/ws', {
				beforeHandle({ body }: any) {
					if (body === 'error') return new OutOfCredit()
					if (body === 'value') return 'denied'
				},
				afterHandle() {
					ran.push('afterHandle')
				},
				message() {
					ran.push('message')
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		try {
			await wsOpen(ws)

			let message = wsMessage(ws)
			ws.send('error')
			expect(
				JSON.parse(
					(await within(message, 'the error frame')).data as string
				)
			).toMatchObject({ type: 'OUT_OF_CREDIT', status: 402 })

			// a plain answer still skips the handler only, as on HTTP
			message = wsMessage(ws)
			ws.send('value')
			expect((await within(message, 'the answer')).data).toBe('denied')
			await Bun.sleep(10)

			expect(ran).toEqual(['afterHandle'])
		} finally {
			await wsClosed(ws)
			app.stop(true)
		}
	})

	// not an Error: a status answer is sent as its status frame, as before
	it('still sends a returned status as a status frame, past the error hooks', async () => {
		const seen: unknown[] = []

		const app = new Elysia()
			.use(websocket())
			.onError(({ error }) => {
				seen.push(error)
			})
			.ws('/ws', {
				beforeHandle({ body }: any) {
					if (body === 'before') return status(403, 'no')
				},
				message(ws: any) {
					if (ws.body === 'ws') return ws.status(400, 'bad')
					return status(409, 'taken')
				}
			})
			.listen(0)

		const ws = newWebsocket(app.server!)

		try {
			await wsOpen(ws)

			for (const [body, frame] of [
				['before', { status: 403, error: 'no' }],
				['ws', { status: 400, error: 'bad' }],
				['message', { status: 409, error: 'taken' }]
			] as const) {
				const message = wsMessage(ws)
				ws.send(body)

				expect(
					JSON.parse((await within(message, body)).data as string)
				).toEqual(frame)
			}

			expect(seen).toEqual([])
		} finally {
			await wsClosed(ws)
			app.stop(true)
		}
	})
})
