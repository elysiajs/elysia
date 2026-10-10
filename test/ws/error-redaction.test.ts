import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia, HTTPError, status } from '../../src'
import { websocket } from '../../src/plugin/websocket'
import { newWebsocket, wsOpen, wsMessage, wsClosed } from './utils'

// Unexpected errors must not expose their messages to production clients.
const frameFor = async (message: () => unknown): Promise<string> => {
	const app = new Elysia().use(websocket()).ws('/ws', { message }).listen(0)

	const ws = newWebsocket(app.server!)
	await wsOpen(ws)

	const msg = wsMessage(ws)
	ws.send('trigger')
	const { data } = await msg

	await wsClosed(ws)
	app.stop()

	return String(data)
}

const httpResponseOf = async (thrown: () => unknown) => {
	const response = await new Elysia()
		.get('/', () => {
			throw thrown()
		})
		.handle(new Request('http://localhost/'))

	return { status: response.status, body: await response.text() }
}

const throws4xx = () => {
	throw Object.assign(new Error('secret internal detail'), { status: 403 })
}

const throws5xx = () => {
	throw Object.assign(new Error('secret internal detail'), { status: 500 })
}

describe('WebSocket error redaction', () => {
	afterEach(() => {
		delete process.env.NODE_ENV
	})

	// A 4xx status is developer-authored intent, so its message is visible
	// in production just like the HTTP transport (`statusFallbackBody`).
	it('includes unexpected 4xx messages in production', async () => {
		process.env.NODE_ENV = 'production'

		await expect(frameFor(throws4xx)).resolves.toContain(
			'secret internal detail'
		)
	})

	it('redacts unexpected 5xx messages in production', async () => {
		process.env.NODE_ENV = 'production'

		await expect(frameFor(throws5xx)).resolves.toBe('Internal Server Error')
	})

	it('includes unexpected 4xx messages during development', async () => {
		delete process.env.NODE_ENV

		await expect(frameFor(throws4xx)).resolves.toContain(
			'secret internal detail'
		)
	})

	it('preserves explicit error response bodies in production', async () => {
		process.env.NODE_ENV = 'production'

		await expect(
			frameFor(() => status(403, 'Forbidden'))
		).resolves.toContain('Forbidden')
	})

	// A status written as a name must resolve before the `>= 500` mask, as on
	// HTTP, or a named 5xx walks its message straight through
	it('redacts a 5xx written as a status name in production', async () => {
		process.env.NODE_ENV = 'production'

		class NamedForeign extends Error {
			readonly status = 'Bad Gateway'
		}

		await expect(
			frameFor(() => {
				throw new NamedForeign('secret internal detail')
			})
		).resolves.toBe('Internal Server Error')
	})
})

// The same production 5xx trust rule as HTTP: an owned HTTPError is trusted
// with its knobs, a foreign error typed as a problem keeps the problem shape
// but nothing past its `type` and `status`
describe('WebSocket problem frames in production', () => {
	afterEach(() => {
		delete process.env.NODE_ENV
	})

	it('masks an owned 5xx message with its own status title', async () => {
		process.env.NODE_ENV = 'production'

		class Owned503 extends HTTPError.id('OWNED_503', 503) {}

		const frame = await frameFor(() => {
			throw new Owned503('secret internal detail')
		})

		expect(frame).not.toContain('secret internal detail')
		expect(JSON.parse(frame)).toEqual({
			type: 'OWNED_503',
			code: 'OWNED_503',
			title: 'Service Unavailable',
			detail: 'Service Unavailable',
			status: 503
		})
	})

	it('serves a foreign 5xx claiming a type a masked problem frame', async () => {
		process.env.NODE_ENV = 'production'

		const invoked: string[] = []

		class Implementer extends Error implements HTTPError<'IMPLEMENTER'> {
			readonly type = 'IMPLEMENTER'
			readonly code = 'implementer-code'
			readonly status = 503

			detail() {
				invoked.push('detail')
				return 'implementer-detail'
			}

			value() {
				invoked.push('value')
				return { secret: 'implementer-value' }
			}
		}

		const thrown = () => new Implementer('implementer-secret')
		const frame = await frameFor(() => {
			throw thrown()
		})

		expect(frame).not.toContain('implementer-')
		expect(JSON.parse(frame)).toEqual({
			type: 'IMPLEMENTER',
			title: 'Service Unavailable',
			detail: 'Service Unavailable',
			status: 503
		})
		expect(frame).toBe((await httpResponseOf(thrown)).body)
		expect(invoked).toEqual([])
	})

	// HTTP only gives the problem shape to an Error carrying a usable 5xx, the
	// rest fall to its legacy masks. Neither runs a knob
	it('serves what HTTP does for a foreign claim without a usable 5xx', async () => {
		process.env.NODE_ENV = 'production'

		const invoked: string[] = []
		const detail = () => {
			invoked.push('detail')
			return 'claimant-detail'
		}

		class StatusLess extends Error {
			readonly type = 'STATUS_LESS'
			readonly detail = detail
		}

		for (const thrown of [
			() => new StatusLess('claimant-secret'),
			() => ({
				type: 'PLAIN',
				status: 503,
				message: 'claimant-secret',
				detail
			})
		]) {
			const frame = await frameFor(() => {
				throw thrown()
			})

			expect(frame).not.toContain('claimant-')
			expect(frame).toBe((await httpResponseOf(thrown)).body)
		}

		expect(invoked).toEqual([])
	})

	it('serves the `type` its claim was checked on', async () => {
		process.env.NODE_ENV = 'production'

		class FlipType extends Error {
			readonly status = 503
			#reads = 0

			get type(): unknown {
				return this.#reads++ === 0 ? 'FLIP' : { marker: 'second-read' }
			}
		}

		const frame = await frameFor(() => {
			throw new FlipType('flip-secret')
		})

		expect(frame).not.toContain('second-read')
		expect(JSON.parse(frame)).toEqual({
			type: 'FLIP',
			title: 'Service Unavailable',
			detail: 'Service Unavailable',
			status: 503
		})
	})
})

// The claim checks `type` is a string, the document checks `code`. Reading
// either again lets a getter answer the check with one value and the wire
// with another, on both transports
describe('problem members are read once', () => {
	// Owned is trusted, but what reaches the wire is still what was checked
	it('serves the checked `type` and `code` of an owned error', async () => {
		class OwnedFlip extends HTTPError<'OWNED_FLIP'> {
			override readonly status = 409
			typeReads = 0
			codeReads = 0

			get type(): any {
				return this.typeReads++ === 0
					? 'OWNED_FLIP'
					: { marker: 'second-read' }
			}
		}

		// `code` is declared as a property on HTTPError, an accessor override
		// has to go on the prototype
		Object.defineProperty(OwnedFlip.prototype, 'code', {
			get(this: OwnedFlip) {
				return this.codeReads++ === 0
					? 'owned-code'
					: { marker: 'second-read' }
			}
		})

		const thrown = () => new OwnedFlip('flip-message')
		const expected = {
			type: 'OWNED_FLIP',
			code: 'owned-code',
			title: 'Conflict',
			detail: 'flip-message',
			status: 409
		}

		const http = await httpResponseOf(thrown)
		expect(JSON.parse(http.body)).toEqual(expected)

		const frame = await frameFor(() => {
			throw thrown()
		})
		expect(JSON.parse(frame)).toEqual(expected)
	})

	// A first read of no `type` is no claim: a second read must not turn it
	// into one, running a stranger's knob for an `about:blank` document
	it('keeps an error that read no `type` out of the problem lane', async () => {
		const invoked: string[] = []

		class LateType extends Error {
			readonly status = 409
			typeReads = 0

			get type(): any {
				return this.typeReads++ === 0 ? undefined : 'SECOND_READ'
			}

			detail() {
				invoked.push('detail')
				return 'late-detail'
			}
		}

		const thrown = () => new LateType('plain message')

		const http = await httpResponseOf(thrown)
		expect(http).toEqual({ status: 409, body: 'plain message' })

		const frame = await frameFor(() => {
			throw thrown()
		})
		expect(frame).toBe('plain message')

		expect(invoked).toEqual([])
	})
})
