// `HTTPError#extension()` adds RFC 9457 §3.2 extension members to the problem
// document Elysia already builds, so an error carrying data no longer has to
// rebuild `type`/`code`/`title` by hand through `value()`. The members
// Elysia owns stay Elysia's, and the production mask still decides what a
// foreign error may disclose

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { Elysia, HTTPError } from '../../src'

// production masks what a foreign error discloses: hand back what was found
let originalNodeEnv: string | undefined
beforeEach(() => {
	originalNodeEnv = process.env.NODE_ENV
})
afterEach(() => {
	if (originalNodeEnv === undefined) delete process.env.NODE_ENV
	else process.env.NODE_ENV = originalNodeEnv
})

// RFC 9457 §3.2's own example
class OutOfCredit extends HTTPError.id('OUT_OF_CREDIT', 402) {
	readonly detail = 'Your current balance is 30, but that costs 50'

	constructor(readonly balance: number) {
		super()
	}

	extension() {
		return { balance: this.balance, accounts: ['/account/12345'] }
	}
}

const rfcExample = {
	type: 'OUT_OF_CREDIT',
	code: 'OUT_OF_CREDIT',
	title: 'Payment Required',
	status: 402,
	detail: 'Your current balance is 30, but that costs 50',
	balance: 30,
	accounts: ['/account/12345']
}

const serve = async (app: { handle(request: Request): Promise<Response> }) => {
	const response = await app.handle(new Request('http://localhost/'))

	return {
		status: response.status,
		type: response.headers.get('content-type'),
		body: await response.json()
	}
}

const throwing = (error: () => unknown) =>
	new Elysia().get('/', () => {
		throw error()
	})

describe('HTTPError extension members', () => {
	it('serves the RFC 9457 out-of-credit example', async () => {
		expect(await serve(throwing(() => new OutOfCredit(30)))).toEqual({
			status: 402,
			type: 'application/problem+json',
			body: rfcExample
		})
	})

	// every way an error reaches the renderer serves the same document
	it('rides a returned error, a beforeHandle answer and an error hook answer', async () => {
		const apps = {
			returned: new Elysia().get('/', () => new OutOfCredit(30)),
			beforeHandle: new Elysia().get(
				'/',
				{ beforeHandle: () => new OutOfCredit(30) },
				() => 'ok'
			),
			routeErrorHook: new Elysia().get(
				'/',
				{ error: () => new OutOfCredit(30) },
				() => {
					throw new Error('caught')
				}
			),
			appErrorHook: new Elysia()
				.onError(() => new OutOfCredit(30))
				.get('/', () => {
					throw new Error('caught')
				})
		}

		for (const [lane, app] of Object.entries(apps))
			expect({ lane, ...(await serve(app)) }).toEqual({
				lane,
				status: 402,
				type: 'application/problem+json',
				body: rfcExample
			})
	})

	// `type`, `code` and `status` identify the problem and route the client:
	// an extension may add to the document, never re-label it. A key the
	// class left empty must not leak through either
	it('never lets an extension override `type`, `code` or `status`', async () => {
		const spoof = () => ({
			type: 'https://evil.example/hijack',
			code: 'HIJACK',
			status: 200,
			// served beside them: the extension itself is honored
			balance: 30
		})

		class Annotated extends HTTPError.id('CONFLICT', 409) {
			readonly detail = 'real'

			extension() {
				return spoof()
			}
		}

		// no `detail`, no message: nothing of its own to hold the keys
		class Bare extends HTTPError.id('CONFLICT', 409) {
			extension() {
				return spoof()
			}
		}

		// claims a problem type but carries no `code`
		class Foreign extends Error {
			type = 'CONFLICT'
			status = 409

			extension() {
				return spoof()
			}
		}

		const envelope = {
			type: 'CONFLICT',
			code: 'CONFLICT',
			title: 'Conflict',
			status: 409,
			balance: 30
		}

		expect((await serve(throwing(() => new Annotated()))).body).toEqual({
			...envelope,
			detail: 'real'
		})
		expect((await serve(throwing(() => new Bare()))).body).toEqual(envelope)

		const foreign = await serve(throwing(() => new Foreign()))
		expect(foreign.status).toBe(409)
		expect(foreign.body).toEqual({
			type: 'CONFLICT',
			title: 'Conflict',
			status: 409,
			balance: 30
		})
	})

	// `detail` explains this occurrence: the error's own wins, else a string
	// one from its extension, else the message. Anything else is no
	// explanation and falls through, as a `detail` of the wrong type does
	it('serves the string `detail` of an extension the error has none of', async () => {
		const make = (detail?: string) =>
			class extends HTTPError.id('CONFLICT', 409) {
				override readonly detail = detail

				extension(): Record<string, unknown> {
					return this.message === 'not a string'
						? { detail: 42 }
						: { detail: 'from extension' }
				}
			}

		const Own = make('own')
		const None = make()

		const detailOf = async (error: () => Error) =>
			((await serve(throwing(error))).body as { detail?: unknown }).detail

		expect(await detailOf(() => new Own('message'))).toBe('own')
		expect(await detailOf(() => new None('message'))).toBe('from extension')
		expect(await detailOf(() => new None())).toBe('from extension')
		expect(await detailOf(() => new None('not a string'))).toBe(
			'not a string'
		)

		// an error an error hook returns is served the same
		expect(
			(
				await serve(
					new Elysia().get('/', { error: () => new None() }, () => {
						throw new Error('caught')
					})
				)
			).body
		).toEqual({
			type: 'CONFLICT',
			code: 'CONFLICT',
			title: 'Conflict',
			status: 409,
			detail: 'from extension'
		})
	})

	// `title` and `instance` are the RFC's own optional members, Elysia only
	// defaults `title`
	it('lets an extension set `title` and `instance`', async () => {
		class Occurrence extends HTTPError.id('OUT_OF_CREDIT', 402) {
			extension() {
				return {
					title: 'You do not have enough credit.',
					instance: '/account/12345/msgs/abc'
				}
			}
		}

		expect((await serve(throwing(() => new Occurrence()))).body).toEqual({
			type: 'OUT_OF_CREDIT',
			code: 'OUT_OF_CREDIT',
			title: 'You do not have enough credit.',
			instance: '/account/12345/msgs/abc',
			status: 402
		})
	})

	// The renderer never awaits an extension, and only a plain object is a
	// set of members: spreading an array or a string would serve index keys
	it('ignores anything but a plain object, a Promise included', async () => {
		// each carries an own enumerable key a spread would serve
		const returns = {
			promise: () =>
				Object.assign(Promise.resolve({ leaked: true }), {
					leaked: true
				}),
			null: () => null,
			array: () => ['leaked'],
			string: () => 'leaked',
			function: () => Object.assign(() => {}, { leaked: true }),
			instance: () =>
				new (class Members {
					leaked = true
				})()
		}

		for (const [kind, extension] of Object.entries(returns)) {
			let invoked = 0

			class Odd extends HTTPError.id('ODD', 400) {
				extension() {
					invoked++
					return extension() as any
				}
			}

			const { body } = await serve(throwing(() => new Odd()))

			expect({ kind, invoked, body }).toEqual({
				kind,
				invoked: 1,
				body: {
					type: 'ODD',
					code: 'ODD',
					title: 'Bad Request',
					status: 400
				}
			})
		}
	})

	// Members are copied as data: an own `__proto__` key stays a member
	// instead of becoming the document's prototype, and data under the name
	// of a hook (`next`, `then`, `toJSON`) is still just data
	it('copies members as data', async () => {
		class Paged extends HTTPError.id('PAGED', 409) {
			extension() {
				return JSON.parse(
					'{"__proto__":{"polluted":true},"next":"/orders?page=2","then":"retry later","toJSON":"data"}'
				)
			}
		}

		const response = await throwing(() => new Paged()).handle(
			new Request('http://localhost/')
		)
		const body = JSON.parse(await response.text())

		expect(response.status).toBe(409)
		expect(
			Object.entries(body).sort(([a], [b]) => (a < b ? -1 : 1))
		).toEqual([
			['__proto__', { polluted: true }],
			['code', 'PAGED'],
			['next', '/orders?page=2'],
			['status', 409],
			['then', 'retry later'],
			['title', 'Conflict'],
			['toJSON', 'data'],
			['type', 'PAGED']
		])
	})

	// Read once, as `value` is: what was checked is what runs
	it('reads `extension` once', async () => {
		class Flaky extends HTTPError.id('FLAKY', 409) {
			reads = 0

			// @ts-ignore a getter in place of the method
			get extension() {
				return ++this.reads === 1 ? () => ({ balance: 30 }) : undefined
			}
		}

		const error = new Flaky()

		expect(await serve(throwing(() => error))).toEqual({
			status: 409,
			type: 'application/problem+json',
			body: {
				type: 'FLAKY',
				code: 'FLAKY',
				title: 'Conflict',
				status: 409,
				balance: 30
			}
		})
		expect(error.reads).toBe(1)
	})

	// Same gate as `value()`: a method on an error that never claimed a
	// problem type is someone else's API, not an annotation
	it('never invokes the extension of an error claiming no problem type', async () => {
		const ran: string[] = []

		class Foreign extends Error {
			status = 418
			detail = 'short and stout'

			extension(): Record<string, unknown> {
				ran.push('foreign')
				return { leaked: true }
			}
		}

		// the same error once it claims a problem type
		class Claiming extends Foreign {
			type = 'TEAPOT'

			override extension() {
				ran.push('claiming')
				return { served: true }
			}
		}

		const foreign = await serve(throwing(() => new Foreign()))
		expect(foreign.status).toBe(418)
		expect(foreign.body).not.toHaveProperty('leaked')

		expect((await serve(throwing(() => new Claiming()))).body).toEqual({
			type: 'TEAPOT',
			title: "I'm a teapot",
			detail: 'short and stout',
			status: 418,
			served: true
		})
		expect(ran).toEqual(['claiming'])

		// a data `extension` is someone else's field, not an annotation
		class Unsupported extends Error {
			type = 'UNSUPPORTED_FILE'
			status = 415
			extension = 'pdf'
		}

		expect(await serve(throwing(() => new Unsupported('no pdf')))).toEqual({
			status: 415,
			type: 'application/problem+json',
			body: {
				type: 'UNSUPPORTED_FILE',
				title: 'Unsupported Media Type',
				detail: 'no pdf',
				status: 415
			}
		})
	})

	// An error inside the error path has nowhere left to fall: a throwing
	// extension is served as a throwing `value()` is
	it('serves a throwing extension as a throwing `value()`', async () => {
		class BrokenExtension extends HTTPError.id('BROKEN', 402) {
			extension(): Record<string, unknown> {
				throw new Error('broken annotation')
			}
		}

		class BrokenValue extends HTTPError.id('BROKEN', 402) {
			value(): unknown {
				throw new Error('broken annotation')
			}
		}

		const extension = await serve(throwing(() => new BrokenExtension()))

		expect(extension.status).toBe(500)
		expect(extension).toEqual(
			await serve(throwing(() => new BrokenValue()))
		)
	})

	// `value()` replaces the whole response, so an extension has nothing to
	// ride and must not run: it may have side effects
	it('runs only when `value()` declines', async () => {
		const ran: string[] = []

		const make = (value: () => unknown) =>
			class extends HTTPError.id('VALUE', 402) {
				value() {
					return value()
				}

				extension() {
					ran.push('extension')
					return { member: true }
				}
			}

		const answers = make(() => ({ whole: true }))
		const answersAsync = make(async () => ({ whole: true }))
		const declines = make(() => undefined)
		const declinesAsync = make(async () => undefined)

		expect((await serve(throwing(() => new answers()))).body).toEqual({
			whole: true
		})
		expect((await serve(throwing(() => new answersAsync()))).body).toEqual({
			whole: true
		})
		expect(ran).toEqual([])

		for (const Declines of [declines, declinesAsync])
			expect((await serve(throwing(() => new Declines()))).body).toEqual({
				type: 'VALUE',
				code: 'VALUE',
				title: 'Payment Required',
				status: 402,
				member: true
			})
		expect(ran).toEqual(['extension', 'extension'])
	})

	// Members follow the trust rule of a declared `detail`: an owned error
	// describes itself even on a production 5xx, a foreign one is masked
	// and never asked
	it('masks the extension of a foreign 5xx in production only', async () => {
		process.env.NODE_ENV = 'production'

		const ran: string[] = []

		class Owned extends HTTPError.id('UNAVAILABLE', 503) {
			extension() {
				ran.push('owned')
				return { retryAfter: 30 }
			}
		}

		class Foreign extends Error {
			type = 'UNAVAILABLE'
			status = 503

			extension() {
				ran.push('foreign')
				return { internalHost: 'db-7.internal' }
			}
		}

		class ForeignClientError extends Error {
			type = 'CONFLICT'
			status = 409

			extension() {
				ran.push('foreign 4xx')
				return { conflictsWith: '/orders/1' }
			}
		}

		expect((await serve(throwing(() => new Owned('secret')))).body).toEqual(
			{
				type: 'UNAVAILABLE',
				code: 'UNAVAILABLE',
				title: 'Service Unavailable',
				detail: 'Service Unavailable',
				status: 503,
				retryAfter: 30
			}
		)
		expect(
			(await serve(throwing(() => new Foreign('secret')))).body
		).toEqual({
			type: 'UNAVAILABLE',
			title: 'Service Unavailable',
			detail: 'Service Unavailable',
			status: 503
		})
		expect(
			(await serve(throwing(() => new ForeignClientError()))).body
		).toMatchObject({ status: 409, conflictsWith: '/orders/1' })
		expect(ran).toEqual(['owned', 'foreign 4xx'])
	})

	// An extension `detail` is the error's own `detail`, so an owned error
	// serves it in place of the masked message even on a production 5xx
	it('serves the extension `detail` of an owned 5xx in production', async () => {
		process.env.NODE_ENV = 'production'

		class Owned extends HTTPError.id('UNAVAILABLE', 503) {
			extension() {
				return { detail: 'Retry in 30 seconds' }
			}
		}

		class Foreign extends Error {
			type = 'UNAVAILABLE'
			status = 503

			extension() {
				return { detail: 'db-7.internal is down' }
			}
		}

		expect((await serve(throwing(() => new Owned('secret')))).body).toEqual(
			{
				type: 'UNAVAILABLE',
				code: 'UNAVAILABLE',
				title: 'Service Unavailable',
				detail: 'Retry in 30 seconds',
				status: 503
			}
		)
		expect(
			(await serve(throwing(() => new Foreign('secret')))).body
		).toEqual({
			type: 'UNAVAILABLE',
			title: 'Service Unavailable',
			detail: 'Service Unavailable',
			status: 503
		})
	})
})
