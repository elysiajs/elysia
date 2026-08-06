import { Elysia, HTTPError, NotFound, problem, status, t, tag } from '../../src'
import { describe, expect, it } from 'bun:test'

class OutOfCredit extends HTTPError<'OUT_OF_CREDIT'> {
	type = 'OUT_OF_CREDIT' as const
	override readonly status = 402
	override readonly headers = { 'x-credit': '0' }

	detail() {
		return 'Out of credit'
	}
}

describe('HTTPError', () => {
	// Everything an owned error serves is RFC 9457: `type` is the tag, the
	// annotated object body merges into the envelope, `title` is filled in
	it('map a thrown self-describing error', async () => {
		const app = new Elysia().get('/', () => {
			throw new OutOfCredit()
		})

		const response = await app.handle('/')

		expect(response.status).toBe(402)
		expect(response.headers.get('x-credit')).toBe('0')
		expect(response.headers.get('content-type')).toStartWith(
			'application/problem+json'
		)
		await expect(response.json()).resolves.toEqual({
			type: 'OUT_OF_CREDIT',
			title: 'Payment Required',
			detail: 'Out of credit',
			status: 402
		})
	})

	it('map a returned self-describing error', async () => {
		const app = new Elysia().get('/', () => new OutOfCredit())

		const response = await app.handle('/')

		expect(response.status).toBe(402)
		expect(response.headers.get('x-credit')).toBe('0')
		await expect(response.json()).resolves.toEqual({
			type: 'OUT_OF_CREDIT',
			title: 'Payment Required',
			detail: 'Out of credit',
			status: 402
		})
	})

	// The annotated `type` is what identifies the problem to a client, a
	// slug and a URI are both valid RFC 9457 type values
	it('serve a URI type annotation verbatim', async () => {
		class Denied extends HTTPError<'https://example.com/errors/denied'> {
			type = 'https://example.com/errors/denied' as const
			override readonly status = 402

			detail() {
				return 'no funds'
			}
		}

		const app = new Elysia().get('/', () => {
			throw new Denied()
		})

		await expect((await app.handle('/')).json()).resolves.toMatchObject({
			type: 'https://example.com/errors/denied'
		})
	})

	// `value` is the escape hatch: no envelope is imposed at all, so an app
	// migrating off a bespoke error shape can keep serving it
	it('let `value` replace the whole response', async () => {
		class Legacy extends HTTPError<'LEGACY'> {
			type = 'LEGACY' as const
			override readonly status = 409

			value() {
				return { code: 'LEGACY', ok: false }
			}
		}

		const app = new Elysia().get('/', () => {
			throw new Legacy()
		})

		const response = await app.handle('/')

		expect(response.status).toBe(409)
		// mapResponse infers the content type, exactly as for a handler return
		expect(response.headers.get('content-type')).toStartWith(
			'application/json'
		)
		// no `type`, no `title`, no `status` — nothing but what was returned
		await expect(response.json()).resolves.toEqual({
			code: 'LEGACY',
			ok: false
		})
	})

	// A body that isn't a plain object can't merge into the envelope, it
	// becomes the `detail` member instead. Arrays included, spreading one
	// would produce `{"0":…}` garbage
	it('serve a non-object body as `detail`', async () => {
		class StringBody extends HTTPError<'STRING_BODY'> {
			type = 'STRING_BODY' as const
			override readonly status = 409

			detail() {
				return 'conflicting write'
			}
		}

		class ArrayBody extends HTTPError<'ARRAY_BODY'> {
			type = 'ARRAY_BODY' as const
			override readonly status = 422

			detail() {
				return ['name', 'email']
			}
		}

		const app = new Elysia()
			.get('/string', () => {
				throw new StringBody()
			})
			.get('/array', () => {
				throw new ArrayBody()
			})

		await expect((await app.handle('/string')).json()).resolves.toEqual({
			type: 'STRING_BODY',
			title: 'Conflict',
			detail: 'conflicting write',
			status: 409
		})

		await expect(
			(await app.handle('/array')).json()
		).resolves.toMatchObject({
			detail: ['name', 'email']
		})
	})

	it('await a promised body', async () => {
		class Deferred extends HTTPError<'DEFERRED'> {
			type = 'DEFERRED' as const
			override readonly status = 409

			async detail() {
				return { deferred: true }
			}
		}

		const app = new Elysia().get('/', () => {
			throw new Deferred()
		})

		const response = await app.handle('/')

		expect(response.status).toBe(409)
		await expect(response.json()).resolves.toEqual({
			type: 'DEFERRED',
			title: 'Conflict',
			detail: { deferred: true },
			status: 409
		})
	})

	// A rejected body must not escape as an unhandled rejection, the sync
	// error lane returns the promise without awaiting it
	it('serve 500 when a promised body rejects', async () => {
		class Broken extends HTTPError<'BROKEN'> {
			type = 'BROKEN' as const
			override readonly status = 409

			async detail(): Promise<unknown> {
				throw new Error('body failed')
			}
		}

		const app = new Elysia().get('/', () => {
			throw new Broken()
		})

		const unhandled: unknown[] = []
		const trap = (reason: unknown) => unhandled.push(reason)
		process.on('unhandledRejection', trap)

		try {
			const response = await app.handle('/')

			expect(response.status).toBe(500)
			await expect(response.json()).resolves.toMatchObject({
				status: 500,
				title: 'Internal Server Error'
			})

			await Bun.sleep(10)
			expect(unhandled).toEqual([])
		} finally {
			process.off('unhandledRejection', trap)
		}
	})

	// The headers describe the annotated body, they must not ride along on
	// the internal 500 that replaces it
	it('drop annotated headers when a promised body rejects', async () => {
		class Leaky extends HTTPError<'LEAKY'> {
			type = 'LEAKY' as const
			override readonly status = 409
			override readonly headers = { 'set-cookie': 'session=leak' }

			async detail(): Promise<unknown> {
				throw new Error('body failed')
			}
		}

		const app = new Elysia().get('/', () => {
			throw new Leaky()
		})

		const response = await app.handle('/')

		expect(response.status).toBe(500)
		expect(response.headers.get('set-cookie')).toBeNull()
	})

	// Resolving `undefined` annotates nothing, the sync path serves the
	// message for the same shape
	it('fall back to the message when a promised body resolves undefined', async () => {
		class Empty extends HTTPError<'EMPTY'> {
			type = 'EMPTY' as const
			override readonly status = 410

			async detail() {
				return undefined
			}
		}

		const app = new Elysia().get('/', () => {
			throw new Empty('nothing here')
		})

		const response = await app.handle('/')

		expect(response.status).toBe(410)
		await expect(response.json()).resolves.toEqual({
			type: 'EMPTY',
			title: 'Gone',
			detail: 'nothing here',
			status: 410
		})
	})

	// `SelfDescribedErrorBody` types an optional body as `Payload | string`,
	// both arms are problem-shaped
	it('serve either branch of an optional body', async () => {
		class Maybe extends HTTPError<'MAYBE'> {
			type = 'MAYBE' as const
			override readonly status = 404

			constructor(public present: boolean) {
				super('absent')
			}

			detail() {
				return this.present ? 'present' : undefined
			}
		}

		const app = new Elysia()
			.get('/present', () => new Maybe(true))
			.get('/absent', () => new Maybe(false))

		const present = await app.handle('/present')
		expect(present.status).toBe(404)
		await expect(present.json()).resolves.toMatchObject({
			type: 'MAYBE',
			detail: 'present'
		})

		const absent = await app.handle('/absent')
		expect(absent.status).toBe(404)
		await expect(absent.json()).resolves.toMatchObject({
			type: 'MAYBE',
			detail: 'absent'
		})
	})

	// An error inside the error path has nowhere left to fall, it must not
	// escape as an unhandled exception
	it('serve 500 when the body getter throws', async () => {
		class Exploding extends HTTPError<'EXPLODING'> {
			type = 'EXPLODING' as const
			override readonly status = 402
			override readonly headers = { 'x-credit': '0' }

			detail(): unknown {
				throw new Error('detail failed')
			}
		}

		const app = new Elysia().get('/', () => {
			throw new Exploding()
		})

		const response = await app.handle('/')

		expect(response.status).toBe(500)
		expect(response.headers.get('x-credit')).toBeNull()
		await expect(response.json()).resolves.toMatchObject({
			status: 500,
			title: 'Internal Server Error'
		})
	})

	// `set.status` already accepts a status name, the error path only has to
	// resolve it for its own `>= 100` / `>= 500` decisions
	it('serve a status annotated by name', async () => {
		class Denied extends HTTPError<'DENIED'> {
			type = 'DENIED' as const
			override readonly status = 'Payment Required'

			detail() {
				return 'Out of credit'
			}
		}

		const app = new Elysia()
			.get('/thrown', () => {
				throw new Denied()
			})
			.get('/returned', () => new Denied())

		for (const path of ['/thrown', '/returned']) {
			const response = await app.handle(path)

			expect(response.status).toBe(402)
			await expect(response.json()).resolves.toEqual({
				type: 'DENIED',
				title: 'Payment Required',
				detail: 'Out of credit',
				status: 402
			})
		}
	})

	// A named status is an Elysia-specific convention, so it opts a foreign
	// error into the duck path the same way a numeric one does
	it('accept a status name on an error that only implements the contract', async () => {
		class Implemented extends Error {
			readonly status = 'Forbidden' as const
			readonly value = { detail: 'forbidden' }
		}

		const app = new Elysia().get('/', () => {
			throw new Implemented()
		})

		const response = await app.handle('/')

		expect(response.status).toBe(403)
		expect(response.headers.get('content-type')).not.toStartWith(
			'application/problem+json'
		)
		await expect(response.json()).resolves.toEqual({ detail: 'forbidden' })
	})

	// `NaN >= 500` is false, so a malformed status would otherwise duck past
	// the production mask a well-formed 5xx never gets
	it('ignore a malformed status on a foreign error', async () => {
		class Foreign extends Error {
			readonly status = NaN
			readonly value = { detail: 'upstream-secret' }
		}

		const app = new Elysia().get('/', () => {
			throw new Foreign()
		})

		const response = await app.handle('/')

		expect(response.status).toBe(500)
		await expect(response.text()).resolves.not.toContain('upstream-secret')
	})

	// SAFETY PIN: `ValidationError` (the runtime's own validation failure)
	// happens to carry a public `value` property — the invalid input — which
	// is now the exact name of the raw-override knob. It must never be read
	// through the knob lane: `ValidationError` inherits `toResponse` from
	// `ElysiaError`, and `fallbackResponse` calls `toResponse` before ever
	// reaching `fallbackErrorResponse`'s duck-typed knob reads, so a
	// validation failure never gets near `readAnnotation`. This pins the
	// standard problem shape rather than a raw dump of the invalid input
	it('serves the standard validation shape, never a raw `.value` dump', async () => {
		const app = new Elysia().post(
			'/',
			{
				body: t.Object({ id: t.Number() })
			},
			({ body }) => body
		)

		const response = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ id: 'not-a-number' })
			})
		)

		expect(response.status).toBe(422)

		const json = await response.json()

		// the standard problem document survives untouched
		expect(json).toMatchObject({ type: 'validation', status: 422 })
		// never the raw invalid input served whole, as the `value` knob would
		expect(json).not.toEqual({ id: 'not-a-number' })
	})

	// A route carrying error hooks compiles its own catch block. It used to
	// inline a copy of the fallback that predated self-description, so an
	// unmatched error was served through the legacy `error.status` lane —
	// status only, empty body, no content-type
	describe('self-description survives an error-hook chain', () => {
		class Unmatched extends tag('UNMATCHED', "I'm a teapot") {}

		class Bodied extends tag('BODIED', 409) {
			detail() {
				return 'annotated'
			}
		}

		class Registered extends tag('REGISTERED', 400) {}

		const matrix = [
			['bare', (app: Elysia) => app],
			[
				'hook-only',
				(app: Elysia) => app.error(() => undefined) as Elysia
			],
			[
				'registered-class',
				(app: Elysia) =>
					app.error(Registered, () => status(400, 'other')) as Elysia
			]
		] as const

		for (const [shape, register] of matrix) {
			it(`serves a body-less error, ${shape}`, async () => {
				const app = register(new Elysia())
					.get('/thrown', () => {
						throw new Unmatched('short and stout')
					})
					.get('/returned', () => new Unmatched('short and stout'))

				for (const path of ['/thrown', '/returned']) {
					const response = await app.handle(path)

					expect(response.status).toBe(418)
					await expect(response.json()).resolves.toEqual({
						type: 'UNMATCHED',
						title: "I'm a teapot",
						detail: 'short and stout',
						status: 418
					})
				}
			})

			it(`serves an annotated body, ${shape}`, async () => {
				const app = register(new Elysia())
					.get('/thrown', () => {
						throw new Bodied()
					})
					.get('/returned', () => new Bodied())

				for (const path of ['/thrown', '/returned']) {
					const response = await app.handle(path)

					expect(response.status).toBe(409)
					expect(response.headers.get('content-type')).toStartWith(
						'application/problem+json'
					)
					await expect(response.json()).resolves.toMatchObject({
						type: 'BODIED',
						detail: 'annotated'
					})
				}
			})
		}

		// A handler returning `problem()` leaves `type` at RFC 9457's
		// "unspecified" default, so the error it intercepted names it
		describe('the error type reaches a handler-produced problem', () => {
			class First extends tag('first', 400) {}
			class Second extends tag('second', 400) {}

			it('adopts the tag of the error the handler intercepted', async () => {
				const app = new Elysia()
					.error(First, () => problem(400, { detail: 'q' }))
					.error(Second, () => problem(400, { detail: 'q' }))
					.get('/first', () => new First())
					.get('/second', () => new Second())

				await expect(
					(await app.handle('/first')).json()
				).resolves.toMatchObject({ type: 'first', detail: 'q' })
				await expect(
					(await app.handle('/second')).json()
				).resolves.toMatchObject({ type: 'second', detail: 'q' })
			})

			it('leaves an explicit type the handler set alone', async () => {
				const app = new Elysia()
					.error(First, () =>
						problem(400, {
							type: 'https://example.com/mine',
							detail: 'q'
						})
					)
					.get('/', () => new First())

				await expect(
					(await app.handle('/')).json()
				).resolves.toMatchObject({ type: 'https://example.com/mine' })
			})

			// `.error(Class, value)` wraps a non-function into `() => value`,
			// so one `ElysiaStatus` instance is replayed for every request and
			// for every class it was registered against. Adopting the tag must
			// copy it — an in-place write would pin the first error's tag onto
			// every later response
			it('copies rather than mutating a replayed result', async () => {
				const shared = problem(400, { detail: 'shared' })

				const app = new Elysia()
					.error(First, shared)
					.error(Second, shared)
					.get('/first', () => new First())
					.get('/second', () => new Second())

				await expect(
					(await app.handle('/first')).json()
				).resolves.toMatchObject({ type: 'first' })
				await expect(
					(await app.handle('/second')).json()
				).resolves.toMatchObject({ type: 'second' })
				// the first request must not have poisoned the second, nor the
				// registered object itself
				await expect(
					(await app.handle('/first')).json()
				).resolves.toMatchObject({ type: 'first' })
				expect((shared.response as { type: string }).type).toBe(
					'about:blank'
				)
			})

			// A plain `status()` result is not a problem document
			it('leaves a non-problem hook result alone', async () => {
				const app = new Elysia()
					.error(First, () => status(400, { type: 'about:blank' }))
					.get('/', () => new First())

				await expect((await app.handle('/')).json()).resolves.toEqual({
					type: 'about:blank'
				})
			})
		})

		// Ground truth for the response *type* of a handler returning a mix of
		// registered errors and a bare `Error`: each registered class is served
		// by its handler, the bare one falls to the unhandled 500
		it('serves registered siblings beside a bare Error', async () => {
			class First extends tag('first') {}
			class Second extends tag('second') {
				value() {
					return problem(418, { detail: 'never reached' })
				}
			}

			const app = new Elysia()
				.error(First, problem(400, { detail: 'q' }))
				.error(Second, problem(401, { detail: 'q' }))
				.get('/first', () => new First())
				.get('/second', () => new Second())
				.get('/bare', () => new Error('boom'))
				.get('/ok', () => 'ok')

			expect((await app.handle('/first')).status).toBe(400)
			// the handler intercepts before `value()` runs, so never 418
			expect((await app.handle('/second')).status).toBe(401)
			expect((await app.handle('/bare')).status).toBe(500)
			expect((await app.handle('/ok')).status).toBe(200)
		})

		// The hook chain still wins when it does match
		it('lets a matching hook take precedence', async () => {
			const app = new Elysia()
				.error(Registered, () => status(400, 'handled'))
				.get('/', () => new Registered())

			const response = await app.handle('/')

			expect(response.status).toBe(400)
			await expect(response.text()).resolves.toBe('handled')
		})

		// `toResponse` is handled by the shared fallback, the hook lane used
		// to carry its own copy of that too
		it('still honours toResponse through the hook lane', async () => {
			const app = new Elysia()
				.error(() => undefined)
				.get('/', () => {
					throw new NotFound('missing')
				})

			const response = await app.handle('/')

			expect(response.status).toBe(404)
			await expect(response.json()).resolves.toMatchObject({
				type: 'not-found',
				status: 404
			})
		})
	})

	it('prefer a registered handler over self-description', async () => {
		const app = new Elysia()
			.get('/', () => new OutOfCredit())
			.error(OutOfCredit, () => status(409, 'handled'))

		const response = await app.handle('/')

		expect(response.status).toBe(409)
		await expect(response.text()).resolves.toBe('handled')
		expect(response.headers.get('x-credit')).toBeNull()
	})

	// `ErrorFallbackBody` types this fall-through as the served problem
	it('self-describe when a registered handler returns undefined', async () => {
		const app = new Elysia()
			.get('/', () => new OutOfCredit())
			.error(OutOfCredit, () => undefined)

		const response = await app.handle('/')

		expect(response.status).toBe(402)
		expect(response.headers.get('x-credit')).toBe('0')
		await expect(response.json()).resolves.toEqual({
			type: 'OUT_OF_CREDIT',
			title: 'Payment Required',
			detail: 'Out of credit',
			status: 402
		})
	})

	// Both knobs are methods so they can be `async` — a getter can return a
	// promise but cannot be declared `async get`
	describe('the detail and value knobs', () => {
		it('runs the method per serve, with `this` bound to the error', async () => {
			class Owed extends tag('OWED', 402) {
				constructor(readonly who: string) {
					super('owed')
				}

				detail() {
					return `${this.who} is out of credit`
				}
			}

			const app = new Elysia().get('/:who', ({ params }) => {
				throw new Owed(params.who)
			})

			await expect(
				(await app.handle('/alice')).json()
			).resolves.toMatchObject({
				type: 'OWED',
				detail: 'alice is out of credit'
			})
			await expect(
				(await app.handle('/bob')).json()
			).resolves.toMatchObject({
				detail: 'bob is out of credit'
			})
		})

		it('awaits an async method', async () => {
			class Deferred extends tag('DEFERRED', 409) {
				async detail() {
					await Bun.sleep(1)
					return { deferred: true }
				}
			}

			const app = new Elysia().get('/', () => {
				throw new Deferred()
			})

			const response = await app.handle('/')

			expect(response.status).toBe(409)
			await expect(response.json()).resolves.toMatchObject({
				type: 'DEFERRED',
				detail: { deferred: true }
			})
		})

		// An already-known value needs no method
		it('accepts an eagerly assigned value detail', async () => {
			class Eager extends tag('EAGER', 410) {
				detail = 'known upfront'
			}

			const app = new Elysia().get('/', () => {
				throw new Eager()
			})

			await expect((await app.handle('/')).json()).resolves.toEqual({
				type: 'EAGER',
				title: 'Gone',
				detail: 'known upfront',
				status: 410
			})
		})

		// Calling a stranger's function is side-effect surface — it may consume
		// a stream or do IO — so it takes the same problem claim the shaping
		// does. A duck error that named no `type` is never invoked and keeps
		// the legacy raw lane
		it('never invokes a function value on an unclaimed duck error', async () => {
			let invoked = false

			class ForeignFn extends Error {
				readonly status = 403

				value() {
					invoked = true
					return { detail: 'must not run' }
				}
			}

			const app = new Elysia().get('/', () => {
				throw new ForeignFn('plain message')
			})

			const response = await app.handle('/')

			expect(invoked).toBe(false)
			expect(response.status).toBe(403)
			await expect(response.text()).resolves.toBe('plain message')
		})

		// Naming a `type` is the claim, so an implementer's method does run
		it('invokes a function body once the error claims a type', async () => {
			class ImplFn extends Error {
				type = 'IMPL_FN' as const
				readonly status = 403

				detail() {
					return 'forbidden'
				}
			}

			const app = new Elysia().get('/', () => {
				throw new ImplFn('m')
			})

			await expect((await app.handle('/')).json()).resolves.toMatchObject(
				{
					type: 'IMPL_FN',
					detail: 'forbidden'
				}
			)
		})

		it('serves 500 when the method throws', async () => {
			class Exploding extends tag('EXPLODING', 402) {
				value(): unknown {
					throw new Error('method failed')
				}
			}

			const app = new Elysia().get('/', () => {
				throw new Exploding()
			})

			const response = await app.handle('/')

			expect(response.status).toBe(500)
			await expect(response.json()).resolves.toMatchObject({
				status: 500,
				title: 'Internal Server Error'
			})
		})

		it('serves a string value verbatim, without an envelope', async () => {
			class Plain extends tag('PLAIN', 409) {
				value() {
					return 'just text'
				}
			}

			const app = new Elysia().get('/', () => {
				throw new Plain()
			})

			const response = await app.handle('/')

			expect(response.status).toBe(409)
			await expect(response.text()).resolves.toBe('just text')
			expect(response.headers.get('content-type')).not.toStartWith(
				'application/problem+json'
			)
		})

		it('accepts an eagerly assigned `value` knob', async () => {
			class Eager extends tag('EAGER', 410) {
				value = { eager: true }
			}

			const app = new Elysia().get('/', () => {
				throw new Eager()
			})

			await expect((await app.handle('/')).json()).resolves.toEqual({
				eager: true
			})
		})

		it('prefers `value` over `detail`', async () => {
			class Both extends tag('BOTH', 402) {
				value() {
					return { winner: 'value' }
				}

				detail() {
					return 'loser'
				}
			}

			const app = new Elysia().get('/', () => {
				throw new Both()
			})

			await expect((await app.handle('/')).json()).resolves.toEqual({
				winner: 'value'
			})
		})

		// `undefined` is the fall-through signal at every tier, and the chain
		// has to survive both knobs being async
		it('falls from an undefined value through to detail', async () => {
			class Falls extends tag('FALLS', 402) {
				value() {
					return undefined
				}

				detail() {
					return 'fell through'
				}
			}

			class AsyncFalls extends tag('ASYNC_FALLS', 402) {
				async value() {
					return undefined
				}

				async detail() {
					return 'fell through'
				}
			}

			const app = new Elysia()
				.get('/sync', () => {
					throw new Falls()
				})
				.get('/async', () => {
					throw new AsyncFalls()
				})

			for (const path of ['/sync', '/async']) {
				const response = await app.handle(path)

				expect(response.status).toBe(402)
				await expect(response.json()).resolves.toMatchObject({
					detail: 'fell through'
				})
			}
		})

		// The execution gate covers both knobs identically
		it('never invokes a function detail on an unclaimed duck error', async () => {
			let invoked = false

			class ForeignFn extends Error {
				readonly status = 403

				detail() {
					invoked = true
					return 'must not run'
				}
			}

			const app = new Elysia().get('/', () => {
				throw new ForeignFn('plain message')
			})

			const response = await app.handle('/')

			expect(invoked).toBe(false)
			expect(response.status).toBe(403)
			await expect(response.text()).resolves.toBe('plain message')
		})

		// A value annotation is inert data, so it participates even unclaimed
		it('still honours a value detail on an unclaimed duck error', async () => {
			class ForeignValue extends Error {
				readonly status = 403
				readonly detail = { why: 'inert data' }
			}

			const app = new Elysia().get('/', () => {
				throw new ForeignValue('m')
			})

			await expect((await app.handle('/')).json()).resolves.toEqual({
				type: 'about:blank',
				title: 'Forbidden',
				detail: { why: 'inert data' },
				status: 403
			})
		})

		it('serves 500 when `detail` throws', async () => {
			class Exploding extends tag('EXPLODING', 402) {
				detail(): unknown {
					throw new Error('detail failed')
				}
			}

			const app = new Elysia().get('/', () => {
				throw new Exploding()
			})

			const response = await app.handle('/')

			expect(response.status).toBe(500)
			await expect(response.json()).resolves.toMatchObject({
				status: 500,
				title: 'Internal Server Error'
			})
		})

		// `value` hands its content straight to mapResponse, so a `status()` or
		// `problem()` is served at the status *it* carries, overriding the
		// annotated one entirely
		it('serves a problem returned from `value` at its own status', async () => {
			class Flaky extends tag('FLAKY', 402) {
				value() {
					return problem(503, { detail: 'downstream dead' })
				}
			}

			const app = new Elysia().get('/', () => {
				throw new Flaky()
			})

			const response = await app.handle('/')

			expect(response.status).toBe(503)
			expect(response.headers.get('content-type')).toStartWith(
				'application/problem+json'
			)
			await expect(response.json()).resolves.toEqual({
				type: 'about:blank',
				title: 'Service Unavailable',
				detail: 'downstream dead',
				status: 503
			})
		})

		it('serves a status returned from an async `value` raw', async () => {
			class Made extends tag('MADE', 402) {
				async value() {
					return status(201, { made: 'it' })
				}
			}

			const app = new Elysia().get('/', () => {
				throw new Made()
			})

			const response = await app.handle('/')

			expect(response.status).toBe(201)
			expect(response.headers.get('content-type')).toStartWith(
				'application/json'
			)
			await expect(response.json()).resolves.toEqual({ made: 'it' })
		})

		it('escapes to the returned status through the error-hook lane', async () => {
			class Flaky extends tag('FLAKY', 402) {
				value() {
					return problem(503, { detail: 'downstream dead' })
				}
			}

			const app = new Elysia()
				.error(() => undefined)
				.get('/', () => {
					throw new Flaky()
				})

			const response = await app.handle('/')

			expect(response.status).toBe(503)
			await expect(response.json()).resolves.toMatchObject({
				status: 503,
				detail: 'downstream dead'
			})
		})

		// The JIT emits a separate catch block for routes carrying error hooks
		it('serves method bodies through the error-hook lane', async () => {
			class Async extends tag('ASYNC', 409) {
				async detail() {
					return 'via hooks'
				}
			}

			const app = new Elysia()
				.error(() => undefined)
				.get('/', () => {
					throw new Async()
				})

			await expect((await app.handle('/')).json()).resolves.toEqual({
				type: 'ASYNC',
				title: 'Conflict',
				detail: 'via hooks',
				status: 409
			})
		})
	})

	describe('tag', () => {
		it('carry the tag as `type` and name the class after it', async () => {
			class OutOfCredit extends tag('OUT_OF_CREDIT') {
				override readonly status = 402
			}

			const app = new Elysia().get('/', () => {
				throw new OutOfCredit('no funds')
			})

			const response = await app.handle('/')

			expect(response.status).toBe(402)
			await expect(response.json()).resolves.toMatchObject({
				type: 'OUT_OF_CREDIT',
				detail: 'no funds'
			})
			expect(new OutOfCredit().type).toBe('OUT_OF_CREDIT')
			expect(new OutOfCredit().name).toBe('OUT_OF_CREDIT')
			// the factory result itself, a subclass keeps its own class name
			expect(tag('TAGGED').name).toBe('TAGGED')
		})

		// `id` is a pure tag factory, it makes no status claim
		it('annotate no status', async () => {
			class Bare extends tag('OUT_OF_CREDIT') {}

			expect(new Bare().status).toBeUndefined()
		})

		// A numeric second argument annotates `status` without a class-body
		// override, and the error still serves a full problem envelope
		it('annotate a numeric status via the second argument', async () => {
			class OutOfCredit extends tag('OUT_OF_CREDIT', 402) {}

			expect(new OutOfCredit().status).toBe(402)

			const app = new Elysia().get('/', () => {
				throw new OutOfCredit('no funds')
			})

			const response = await app.handle('/')

			expect(response.status).toBe(402)
			await expect(response.json()).resolves.toEqual({
				type: 'OUT_OF_CREDIT',
				title: 'Payment Required',
				detail: 'no funds',
				status: 402
			})
		})

		// A status name resolves to the same numeric literal as the number
		it('resolve a status name via the second argument', async () => {
			class Denied extends tag('DENIED', 'Payment Required') {}

			expect(new Denied().status).toBe(402)

			const app = new Elysia().get('/', () => new Denied())

			const response = await app.handle('/')

			expect(response.status).toBe(402)
			await expect(response.json()).resolves.toMatchObject({
				type: 'DENIED',
				status: 402
			})
		})

		// A garbage status name must not resolve through `Object.prototype`
		// (e.g. `.constructor`) and land a function on `.status`
		it('leave `status` undefined when the name does not resolve', () => {
			class Garbage extends tag('GARBAGE', 'constructor' as any) {}

			expect(new Garbage().status).toBeUndefined()
		})

		it('register through .error', async () => {
			const Teapot = tag('TEAPOT')

			const app = new Elysia()
				.get('/', () => {
					throw new Teapot()
				})
				.error(Teapot, () => status(400, 'handled'))

			const response = await app.handle('/')

			expect(response.status).toBe(400)
			await expect(response.text()).resolves.toBe('handled')
		})

		it('register a class annotated through the second argument via .error', async () => {
			const Teapot = tag('TEAPOT', 418)

			const app = new Elysia()
				.get('/', () => {
					throw new Teapot()
				})
				.error(Teapot, () => status(400, 'handled'))

			const response = await app.handle('/')

			expect(response.status).toBe(400)
			await expect(response.text()).resolves.toBe('handled')
		})

		// The tag lives on the prototype, an own property would shadow a
		// subclass accessor (which can't be expressed as an instance field).
		// This class also pins the legacy `get value()` form: the method is the
		// documented shape now, but a getter still reads as its value — don't
		// convert this one
		it('let a subclass accessor override the annotation', async () => {
			class Dynamic extends tag('DYNAMIC') {
				get value() {
					return { dynamic: true }
				}
			}

			Object.defineProperty(Dynamic.prototype, 'status', {
				get: () => 418,
				configurable: true
			})

			const app = new Elysia().get('/', () => {
				throw new Dynamic()
			})

			const response = await app.handle('/')

			expect(response.status).toBe(418)
			// `value` overrides the whole response, so no envelope here
			await expect(response.json()).resolves.toEqual({ dynamic: true })
		})
	})

	it('map an error that only implements the contract', async () => {
		class Base extends Error {}

		class Implemented extends Base {
			readonly status = 403
			readonly value = { detail: 'forbidden' }
		}

		const app = new Elysia().get('/', () => {
			throw new Implemented()
		})

		const response = await app.handle('/')

		expect(response.status).toBe(403)
		expect(response.headers.get('content-type')).not.toStartWith(
			'application/problem+json'
		)
		await expect(response.json()).resolves.toEqual({ detail: 'forbidden' })
	})

	it('merge annotated headers into existing headers', async () => {
		const app = new Elysia().get('/', ({ set }) => {
			set.headers['x-base'] = 'kept'

			throw new OutOfCredit()
		})

		const response = await app.handle('/')

		expect(response.status).toBe(402)
		expect(response.headers.get('x-base')).toBe('kept')
		expect(response.headers.get('x-credit')).toBe('0')
	})

	it('fall back to the message when no body is annotated', async () => {
		class Silent extends HTTPError<'SILENT'> {
			type = 'SILENT' as const
			override readonly status = 410
		}

		const app = new Elysia().get('/', () => {
			throw new Silent('gone for good')
		})

		const response = await app.handle('/')

		expect(response.status).toBe(410)
		await expect(response.json()).resolves.toEqual({
			type: 'SILENT',
			title: 'Gone',
			detail: 'gone for good',
			status: 410
		})
	})

	// There's no base `value` member to override, an implementer type-checks
	// against the contract with only `type`. Naming a `type` is the problem
	// claim, so it is served as one even without extending HTTPError
	it('implement the contract without providing a value', async () => {
		class ImplNoValue extends Error implements HTTPError<'IMPL_NO_VALUE'> {
			type = 'IMPL_NO_VALUE' as const
			readonly status = 403
		}

		const app = new Elysia().get('/', () => {
			throw new ImplNoValue('forbidden by policy')
		})

		const response = await app.handle('/')

		expect(response.status).toBe(403)
		await expect(response.json()).resolves.toEqual({
			type: 'IMPL_NO_VALUE',
			title: 'Forbidden',
			detail: 'forbidden by policy',
			status: 403
		})
	})

	// A duck error that names no `type` never claimed a problem document,
	// its legacy raw lane is untouched
	it('leave a body-less foreign duck error on the raw lane', async () => {
		class ForeignBare extends Error {
			readonly status = 403
		}

		const app = new Elysia().get('/', () => {
			throw new ForeignBare('plain message')
		})

		const response = await app.handle('/')

		expect(response.status).toBe(403)
		await expect(response.text()).resolves.toBe('plain message')
		expect(response.headers.get('content-type')).not.toStartWith(
			'application/problem+json'
		)
	})

	// Owned, so problem-shaped even with nothing annotated: `type` survives
	// and the message lands in `detail`
	it('serve 500 for an HTTPError subclass with no status or body', async () => {
		class ExtNoBody extends HTTPError<'EXT_NO_BODY'> {
			type = 'EXT_NO_BODY' as const
		}

		const app = new Elysia().get('/', () => {
			throw new ExtNoBody('unannotated')
		})

		const response = await app.handle('/')

		expect(response.status).toBe(500)
		await expect(response.json()).resolves.toEqual({
			type: 'EXT_NO_BODY',
			title: 'Internal Server Error',
			detail: 'unannotated',
			status: 500
		})
	})
})
