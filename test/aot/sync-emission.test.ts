import '../../src/compile/aot-capture'
import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import {
	endHandlerCapture,
	endValidatorCapture
} from '../../src/compile/aot-capture'
import { compileHandler } from '../../src/compile/handler'
import {
	materialise,
	materialiseHandlers,
	registerManifest
} from './_manifest'
import { req, post } from '../utils'
import { hasSyncHmac } from '../../src/cookie/utils'

/** Synchronous routes stay synchronous unless their work may return a Promise. */

afterEach(() => {
	Compiled.clear()
	Validator.clear()
})

const compileRoute = (app: any, index = 0) => {
	const route = (app as Elysia)['~routes']![index]
	const fn = compileHandler(route as any, app)
	return { fn, name: fn.constructor.name, source: fn.toString() }
}

const isAsync = (app: any, index = 0) =>
	compileRoute(app, index).name === 'AsyncFunction'

describe('synchronous route emission', () => {
	it('plain sync GET is a plain Function', async () => {
		const app = new Elysia().get('/', () => 'hi')

		expect(isAsync(app)).toBe(false)
		await expect((await app.handle(req('/'))).text()).resolves.toBe('hi')
	})

	it('async handler stays AsyncFunction', async () => {
		const app = new Elysia().get(
			'/',
			{
				query: t.Object({ q: t.Optional(t.String()) })
			},
			async () => 'hi'
		)

		expect(isAsync(app)).toBe(true)
		await expect((await app.handle(req('/?q=1'))).text()).resolves.toBe(
			'hi'
		)
	})

	it('sync GET + sync error hook is a plain Function', async () => {
		const app = new Elysia().error(() => {}).get('/', () => 'hi')

		expect(isAsync(app)).toBe(false)
		await expect((await app.handle(req('/'))).text()).resolves.toBe('hi')
	})

	it('sync GET + async error hook stays AsyncFunction', () => {
		const app = new Elysia().error(async () => {}).get('/', () => 'hi')

		expect(isAsync(app)).toBe(true)
	})

	it('sync GET + sync afterResponse is a plain Function', async () => {
		const app = new Elysia().afterResponse(() => {}).get('/', () => 'hi')

		expect(isAsync(app)).toBe(false)
		await expect((await app.handle(req('/'))).text()).resolves.toBe('hi')
	})

	it('sync GET + async afterResponse stays AsyncFunction', () => {
		const app = new Elysia()
			.afterResponse(async () => {})
			.get('/', () => 'hi')

		expect(isAsync(app)).toBe(true)
	})

	it('sync GET + sync error hook + sync afterResponse stays AsyncFunction and serves 200', async () => {
		let fired = false
		const app = new Elysia()
			.error(() => 'mapped-err')
			.afterResponse(() => {
				fired = true
			})
			.get('/', () => 'hi')

		expect(isAsync(app)).toBe(true)

		const ok = await app.handle(req('/'))
		expect(ok.status).toBe(200)
		await expect(ok.text()).resolves.toBe('hi')

		await new Promise((r) => setTimeout(r, 10))
		expect(fired).toBe(true)
	})

	it('error hook + afterResponse still maps a thrown error', async () => {
		const app = new Elysia()
			.error(() => 'mapped-err')
			.afterResponse(() => {})
			.get('/', () => {
				throw new Error('boom')
			})

		const r = await app.handle(req('/'))
		expect(r.status).toBe(500)
		await expect(r.text()).resolves.toBe('mapped-err')
	})

	it('GET reading an unsigned cookie is a plain Function', async () => {
		const app = new Elysia().get('/', ({ cookie }) => {
			cookie.id.value
			return 'hi'
		})

		expect(isAsync(app)).toBe(false)
		await expect(
			(
				await app.handle(req('/', { headers: { cookie: 'id=abc' } }))
			).text()
		).resolves.toBe('hi')
	})

	// Edge runtimes without synchronous HMAC use the asynchronous fallback.
	it('GET reading a signed cookie is sync when a sync HMAC is available', () => {
		const app = new Elysia({
			cookie: { sign: ['id'], secrets: 'secret' }
		}).get('/', ({ cookie }) => {
			cookie.id.value
			return 'hi'
		})

		expect(isAsync(app)).toBe(!hasSyncHmac)
	})

	it('app-level sync .parse + bodyless GET is a plain Function', async () => {
		const app = new Elysia().parse(() => {}).get('/', () => 'hi')

		expect(isAsync(app)).toBe(false)
		await expect((await app.handle(req('/'))).text()).resolves.toBe('hi')
	})

	it('app-level async .parse + bodyless GET is a plain Function (parse skipped)', async () => {
		const app = new Elysia().parse(async () => {}).get('/', () => 'hi')

		expect(isAsync(app)).toBe(false)
		await expect((await app.handle(req('/'))).text()).resolves.toBe('hi')
	})

	it('async .parse on a POST stays AsyncFunction and runs', async () => {
		let ran = false
		const app = new Elysia()
			.parse(async () => {
				ran = true
				return { ok: 1 }
			})
			.post('/', ({ body }) => body)

		expect(isAsync(app)).toBe(true)
		const res = await app.handle(post('/', { a: 1 }))
		expect(ran).toBe(true)
		await expect(res.json()).resolves.toEqual({ ok: 1 })
	})

	it('GET with explicit body schema stays AsyncFunction (parse forced)', () => {
		const app = new Elysia().get(
			'/',
			{
				body: t.Object({ n: t.Number() })
			},
			({ body }) => body
		)

		expect(isAsync(app)).toBe(true)
	})

	it('POST with t.Object body stays AsyncFunction (body read is async)', async () => {
		const app = new Elysia().post(
			'/',
			{
				body: t.Object({ n: t.Number() })
			},
			({ body }) => body
		)

		expect(isAsync(app)).toBe(true)
		await expect(
			(await app.handle(post('/', { n: 5 }))).json()
		).resolves.toEqual({
			n: 5
		})
	})

	it('MultiValidator query (sync) is a plain Function', async () => {
		const fakeStd = {
			'~standard': {
				version: 1,
				vendor: 'x',
				validate: (v: any) => ({ value: v })
			}
		}
		const app = new Elysia().get(
			'/',
			{
				query: t.Object({ q: t.Optional(t.String()) }),
				schemas: [fakeStd as any]
			},
			({ query }) => query
		)

		expect(isAsync(app)).toBe(false)
		const res = await app.handle(req('/?q=hi'))
		expect(res.status).toBe(200)
	})

	// Standard Schema validators may return Promises even when validate is not async.
	it('StandardValidator query forces async emission', async () => {
		const fakeStd = {
			'~standard': {
				version: 1,
				vendor: 'x',
				validate: (v: any) => ({ value: v })
			}
		}
		const app = new Elysia().get(
			'/',
			{
				query: fakeStd as any
			},
			({ query }) => query
		)

		expect(isAsync(app)).toBe(true)
		const res = await app.handle(req('/?q=hi'))
		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ q: 'hi' })
	})

	it('async StandardValidator query stays AsyncFunction', async () => {
		const fakeStd = {
			'~standard': {
				version: 1,
				vendor: 'x',
				validate: async (v: any) => ({ value: v })
			}
		}
		const app = new Elysia().get(
			'/',
			{
				query: fakeStd as any
			},
			({ query }) => query
		)

		expect(isAsync(app)).toBe(true)
		const res = await app.handle(req('/?q=hi'))
		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ q: 'hi' })
	})

	it('conditionally awaits a synchronous POST handler result', () => {
		const app = new Elysia().post(
			'/',
			{
				body: t.Object({ n: t.Number() })
			},
			({ body }) => body
		)

		const { source } = compileRoute(app)
		expect(source).toContain('if(_r instanceof Promise)_r=await _r')
		expect(source).not.toMatch(/_r=await h\(c\)/)
	})
})

describe('Promise rejection from synchronous handlers', () => {
	it('route-level error hook sees a rejection from a sync handler', async () => {
		let seen: unknown
		const app = new Elysia()
			.error((c: any) => {
				seen = c.error
				return new Response('handled', { status: 418 })
			})
			.get('/', () => Promise.reject(new Error('boom')))

		const res = await app.handle(req('/'))
		expect(res.status).toBe(418)
		await expect(res.text()).resolves.toBe('handled')
		expect((seen as Error)?.message).toBe('boom')
	})

	it('sync handler returning a resolving promise still maps normally', async () => {
		const app = new Elysia()
			.error(() => {})
			.get('/', () => Promise.resolve('ok') as any)

		const res = await app.handle(req('/'))
		await expect(res.text()).resolves.toBe('ok')
	})

	// a SYNC throw on a sync error-hook route is caught by the sync
	// try/catch and the route stays a plain Function
	it('sync throw on sync error-hook route is handled (plain Function)', async () => {
		const app = new Elysia()
			.error(({ error, set }: any) => {
				set.status = 400
				return (error as Error).message
			})
			.get('/', () => {
				throw new Error('nope')
			})

		expect(isAsync(app)).toBe(false)
		const res = await app.handle(req('/'))
		expect(res.status).toBe(400)
		await expect(res.text()).resolves.toBe('nope')
	})

	// error hook + response validator must STAY async (the thrown-then-
	// handled value runs through response validation; a naive sync drop flips it)
	it('error hook + response schema stays AsyncFunction', () => {
		const app = new Elysia()
			.error(() => {})
			.get(
				'/',
				{
					response: t.String()
				},
				() => 'hi'
			)

		expect(isAsync(app)).toBe(true)
	})
})

describe('synchronous afterResponse behavior', () => {
	it('sync afterResponse fires for a plain value response', async () => {
		let calls = 0
		const app = new Elysia()
			.afterResponse(() => {
				calls++
			})
			.get('/', () => 'hi')

		expect(isAsync(app)).toBe(false)
		const res = await app.handle(req('/'))
		await expect(res.text()).resolves.toBe('hi')
		await new Promise((r) => setTimeout(r, 10))
		expect(calls).toBe(1)
	})

	it('generator response: tee drains and sync afterResponse fires exactly once', async () => {
		let calls = 0
		const app = new Elysia()
			.afterResponse(() => {
				calls++
			})
			.get('/', function* () {
				yield 'a'
				yield 'b'
			})

		expect(isAsync(app)).toBe(false)

		const res = await app.handle(req('/'))
		await expect(res.text()).resolves.toBe('ab')
		await new Promise((r) => setTimeout(r, 20))
		expect(calls).toBe(1)
	})

	it('sync beforeHandle short-circuit + afterResponse stays sync and fires the hook', async () => {
		let calls = 0
		const app = new Elysia()
			.afterResponse(() => {
				calls++
			})
			.get(
				'/',
				{
					beforeHandle: () => 'short'
				},
				() => 'handler'
			)

		expect(isAsync(app)).toBe(false)
		const res = await app.handle(req('/'))
		await expect(res.text()).resolves.toBe('short')
		await new Promise((r) => setTimeout(r, 10))
		expect(calls).toBe(1)
	})

	it('sync handler returning a generator-Promise still tees + fires afterResponse', async () => {
		let calls = 0
		const app = new Elysia()
			.afterResponse(() => {
				calls++
			})
			.get(
				'/',
				() =>
					Promise.resolve(
						(function* () {
							yield 'x'
							yield 'y'
						})()
					) as any
			)

		expect(isAsync(app)).toBe(false)
		const res = await app.handle(req('/'))
		await expect(res.text()).resolves.toBe('xy')
		await new Promise((r) => setTimeout(r, 20))
		expect(calls).toBe(1)
	})
})

describe('Promise-returning synchronous functions', () => {
	it('resolves a beforeHandle Promise before short-circuiting', async () => {
		let handlerRan = false
		const app = new Elysia().get(
			'/',
			{ beforeHandle: () => Promise.resolve('short') as any },
			() => {
				handlerRan = true
				return 'handler'
			}
		)

		expect(isAsync(app)).toBe(true)

		const res = await app.handle(req('/'))
		await expect(res.text()).resolves.toBe('short')
		expect(handlerRan).toBe(false)
	})

	it('passes the resolved handler value to afterHandle', async () => {
		let seen: unknown
		const app = new Elysia().get(
			'/',
			{
				afterHandle: ({ responseValue }: any) => {
					seen = responseValue
					return `wrapped:${responseValue}`
				}
			},
			() => Promise.resolve('value') as any
		)

		expect(isAsync(app)).toBe(true)

		const res = await app.handle(req('/'))
		await expect(res.text()).resolves.toBe('wrapped:value')
		expect(seen).toBe('value')
	})

	it('passes the resolved handler value to mapResponse', async () => {
		const app = new Elysia().get(
			'/',
			{
				mapResponse: ({ responseValue }: any) =>
					new Response(`mapped:${responseValue}`)
			},
			() => Promise.resolve('value') as any
		)

		expect(isAsync(app)).toBe(true)
		const res = await app.handle(req('/'))
		await expect(res.text()).resolves.toBe('mapped:value')
	})

	it('minified `=>x` handler with a response validator validates', async () => {
		// eval preserves the minified arrow source that Bun would reformat.
		// eslint-disable-next-line no-eval
		const minified = (0, eval)('(c)=>c.query.n') as (c: any) => string
		expect(minified.toString()).toContain('=>c') // truly no space

		const app = new Elysia().get(
			'/',
			{
				query: t.Object({ n: t.String() }),
				response: t.String()
			},
			minified
		)

		const ok = await app.handle(req('/?n=hi'))
		expect(ok.status).toBe(200)
		await expect(ok.text()).resolves.toBe('hi')
	})

	it('minified `=>x` handler returning a Promise-producing identifier is awaited', async () => {
		// eslint-disable-next-line no-eval
		const minified = (0, eval)('(c)=>c.store.p') as (c: any) => unknown
		expect(minified.toString()).toContain('=>c')

		const app = new Elysia()
			.state('p', Promise.resolve('deferred'))
			.get('/', { response: t.String() }, minified as any)

		expect(isAsync(app)).toBe(true)
		const res = await app.handle(req('/'))
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('deferred')
	})

	it('provably-sync handler + sync hooks stay a plain Function', () => {
		const app = new Elysia().get(
			'/',
			{
				beforeHandle: () => {},
				afterHandle: () => {},
				transform: () => {}
			},
			() => ({ ok: 1 })
		)

		expect(isAsync(app)).toBe(false)
	})

	it('runs the handler when a stored beforeHandle Promise resolves to undefined', async () => {
		const p = Promise.resolve(undefined)
		let handlerRan = false
		const app = new Elysia().get('/', { beforeHandle: () => p }, () => {
			handlerRan = true
			return 'ok'
		})

		expect(isAsync(app)).toBe(true)

		const res = await app.handle(req('/'))
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('ok')
		expect(handlerRan).toBe(true)
	})

	it('short-circuits with the value of a stored beforeHandle Promise', async () => {
		const p = Promise.resolve('short')
		let handlerRan = false
		const app = new Elysia().get('/', { beforeHandle: () => p }, () => {
			handlerRan = true
			return 'handler'
		})

		expect(isAsync(app)).toBe(true)
		const res = await app.handle(req('/'))
		await expect(res.text()).resolves.toBe('short')
		expect(handlerRan).toBe(false)
	})

	it('resolves a stored afterHandle Promise before responding', async () => {
		const p = Promise.resolve('wrapped')
		const app = new Elysia().get(
			'/',
			{ afterHandle: () => p as any },
			() => 'orig'
		)

		expect(isAsync(app)).toBe(true)
		const res = await app.handle(req('/'))
		await expect(res.text()).resolves.toBe('wrapped')
	})

	it('resolves a stored mapResponse Promise before responding', async () => {
		const p = Promise.resolve(new Response('mapped'))
		const app = new Elysia().get(
			'/',
			{ mapResponse: () => p as any },
			() => 'orig'
		)

		expect(isAsync(app)).toBe(true)
		const res = await app.handle(req('/'))
		await expect(res.text()).resolves.toBe('mapped')
	})

	it('preserves a pass-through afterHandle response when conservatively async', async () => {
		const app = new Elysia().get(
			'/',
			{ afterHandle: ({ response }: any) => response },
			() => 'passthru'
		)

		expect(isAsync(app)).toBe(true)
		const res = await app.handle(req('/'))
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('passthru')
	})

	it('keeps a stored-Promise transform synchronous because its return is discarded', async () => {
		const p = Promise.resolve('unused')
		let handlerRan = false
		const app = new Elysia().get('/', { transform: () => p as any }, () => {
			handlerRan = true
			return 'ok'
		})

		expect(isAsync(app)).toBe(false)
		const res = await app.handle(req('/'))
		await expect(res.text()).resolves.toBe('ok')
		expect(handlerRan).toBe(true)
	})

	it('async route emits an instanceof-Promise await guard for a sync beforeHandle', () => {
		const app = new Elysia().get(
			'/',
			{ beforeHandle: () => Promise.resolve('x') as any },
			() => 'hi'
		)

		const { source } = compileRoute(app)
		expect(source).toContain('tmp instanceof Promise')
	})
})

describe('frozen handler reconstruction', () => {
	const freeze = async (
		build: () => Elysia<any, any>,
		assert: (frozen: Elysia<any, any>) => Promise<void>
	) => {
		process.env.ELYSIA_AOT_BUILD = '1'
		endHandlerCapture()
		endValidatorCapture()
		;(build() as any).compile()
		const handlers = endHandlerCapture()
		const validators = endValidatorCapture()
		expect(handlers.length).toBeGreaterThan(0)

		delete process.env.ELYSIA_AOT_BUILD
		Validator.clear()
		registerManifest({
			validators: materialise(validators),
			handlers: materialiseHandlers(handlers)
		})

		const frozen = build()
		;(frozen as any).compile()
		await assert(frozen)

		Compiled.clear()
		Validator.clear()
	}

	it('reconstructs error hooks from a frozen factory', async () => {
		const build = () =>
			new Elysia()
				.error(({ error, set }: any) => {
					set.status = 400
					return (error as Error).message
				})
				.get('/', ({ query }: any) => {
					if (query.boom) throw new Error('boom')
					return 'ok'
				}) as any

		await freeze(build, async (frozen) => {
			await expect((await frozen.handle(req('/'))).text()).resolves.toBe(
				'ok'
			)
			const err = await frozen.handle(req('/?boom=1'))
			expect(err.status).toBe(400)
			await expect(err.text()).resolves.toBe('boom')
		})
	})

	it('reconstructs afterResponse hooks from a frozen factory', async () => {
		const counter = { n: 0 }
		const build = () =>
			new Elysia()
				.afterResponse(() => {
					counter.n++
				})
				.get('/', ({ query }: any) => query.q ?? 'ok') as any

		await freeze(build, async (frozen) => {
			counter.n = 0
			await expect(
				(await frozen.handle(req('/?q=hi'))).text()
			).resolves.toBe('hi')
			await new Promise((r) => setTimeout(r, 10))
			expect(counter.n).toBe(1)
		})
	})

	it('reconstructs unsigned-cookie parsing from a frozen factory', async () => {
		const build = () =>
			new Elysia().get(
				'/',
				({ cookie }: any) => cookie.id.value ?? 'none'
			) as any

		await freeze(build, async (frozen) => {
			const res = await frozen.handle(
				req('/', { headers: { cookie: 'id=abc' } })
			)
			await expect(res.text()).resolves.toBe('abc')
		})
	})
})
