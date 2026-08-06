import { Elysia, InternalServerError, t } from '../../src'

import { beforeEach, describe, expect, it } from 'bun:test'

describe('afterResponse', () => {
	it('runs after an error hook returns a response', async () => {
		let isAfterResponseCalled = false

		const app = new Elysia()
			.afterResponse(() => {
				isAfterResponseCalled = true
			})
			.error(() => {
				return new Response('a', {
					status: 401,
					headers: {
						awd: 'b'
					}
				})
			})

		await app.handle('/')
		await Bun.sleep(1)

		expect(isAfterResponseCalled).toBeTrue()
	})

	it('runs for a missing route without an error hook', async () => {
		let isAfterResponseCalled = false

		const app = new Elysia().afterResponse(() => {
			isAfterResponseCalled = true
		})

		await app.handle('/')
		await Bun.sleep(1)

		expect(isAfterResponseCalled).toBeTrue()
	})

	it('runs hooks in registration order', async () => {
		let order = <string[]>[]

		const app = new Elysia()
			.afterResponse(() => {
				order.push('A')
			})
			.afterResponse(() => {
				order.push('B')
			})
			.get('/', () => '')

		await app.handle('/')
		await Bun.sleep(1)

		expect(order).toEqual(['A', 'B'])
	})

	it('appends callbacks from context in registration order', async () => {
		const order: string[] = []
		const app = new Elysia()
			.afterResponse(() => order.push('hook'))
			.get('/', ({ defer }) => {
				defer(async ({ responseValue }) => {
					await Promise.resolve()
					order.push(`first:${responseValue}`)
				})
				defer(() => order.push('second'))
				order.push('handler')

				return 'ok'
			})

		await app.handle('/')
		await Bun.sleep(1)

		expect(order).toEqual(['handler', 'hook', 'first:ok', 'second'])
	})

	it('runs a context callback without a registered hook', async () => {
		let responseValue: unknown
		const app = new Elysia().get('/', ({ defer }) => {
			defer((context) => {
				responseValue = context.responseValue
			})

			return 'ok'
		})

		await app.handle('/')
		await Bun.sleep(1)

		expect(responseValue).toBe('ok')
	})

	it('runs response hooks before a context callback', async () => {
		const order: string[] = []
		const app = new Elysia().get(
			'/',
			{
				afterHandle: () => {
					order.push('afterHandle')
				},
				mapResponse: () => {
					order.push('mapResponse')
					return new Response('mapped')
				}
			},
			({ defer }) => {
				defer(() => order.push('afterResponse'))
				order.push('handler')

				return 'ok'
			}
		)

		const response = await app.handle('/')
		await Bun.sleep(1)

		await expect(response.text()).resolves.toBe('mapped')
		expect(order).toEqual([
			'handler',
			'afterHandle',
			'mapResponse',
			'afterResponse'
		])
	})

	it('receives a typed responseValue through a global plugin hook', async () => {
		let type = ''

		const afterResponse = new Elysia().afterResponse(
			'global',
			({ responseValue }) => {
				type = typeof responseValue
			}
		)

		const app = new Elysia().use(afterResponse).get(
			'/id/:id',
			{
				params: t.Object({
					id: t.Number()
				})
			},
			({ params: { id } }) => id
		)

		await app.handle('/id/1')

		await Bun.sleep(1)

		expect(type).toBe('number')
	})

	it('runs a global plugin hook on plugin and parent routes', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.afterResponse('global', ({ path }) => {
				called.push(path)
			})
			.get('/inner', () => 'NOOP')

		const app = new Elysia().use(plugin).get('/outer', () => 'NOOP')

		await Promise.all([app.handle('/inner'), app.handle('/outer')])
		await Bun.sleep(1)

		expect(called).toEqual(['/inner', '/outer'])
	})

	it('runs a local plugin hook only on plugin routes', async () => {
		const called = <string[]>[]

		const plugin = new Elysia()
			.afterResponse('local', ({ path }) => {
				called.push(path)
			})
			.get('/inner', () => 'NOOP')

		const app = new Elysia().use(plugin).get('/outer', () => 'NOOP')

		await Promise.all([app.handle('/inner'), app.handle('/outer')])
		await Bun.sleep(1)

		expect(called).toEqual(['/inner'])
	})
})

describe('afterResponse drain boundary', () => {
	// A route with a handler compiles through the JIT lane; a request that
	// matches no route falls through to the interpreted lane in
	// `src/handler/fetch.ts`. Both drain the `defer()` queue, so both are pinned.

	const captureWarnings = () => {
		const warnings: string[] = []
		const warn = console.warn
		console.warn = (...values) => warnings.push(values.join(' '))

		return {
			warnings,
			restore: () => {
				console.warn = warn
			}
		}
	}

	it('ignores defer() called from inside the drain', async () => {
		const { warnings, restore } = captureWarnings()

		try {
			const calls: string[] = []

			const app = new Elysia().get('/', ({ defer }) => {
				defer(() => {
					calls.push('outer')
					// bounded on purpose: draining appends made mid-drain lets a
					// self-appending callback spin the loop forever, so an
					// unbounded version of this test would wedge the suite
					// instead of failing it
					if (calls.length < 4) defer(() => calls.push('nested'))
				})

				return 'ok'
			})

			await app.handle('/')
			await Bun.sleep(1)

			expect(calls).toEqual(['outer'])
			// the wedge used to be silent — the warning is the only signal that
			// a callback was dropped
			expect(warnings).toHaveLength(1)
			expect(warnings[0]).toContain('defer()')
		} finally {
			restore()
		}
	})

	it('ignores defer() called from inside the drain on the interpreted lane', async () => {
		const { warnings, restore } = captureWarnings()

		try {
			const calls: string[] = []

			const app = new Elysia().afterResponse(({ defer }) => {
				defer(() => {
					calls.push('outer')
					if (calls.length < 4) defer(() => calls.push('nested'))
				})
			})

			await app.handle('/missing')
			await Bun.sleep(1)

			expect(calls).toEqual(['outer'])
			// the interpreted lane drops the re-entrant defer silently; only
			// the compiled lane emits a dev warning for it
			expect(warnings).toHaveLength(0)
		} finally {
			restore()
		}
	})

	it('runs defer() registered by a static hook', async () => {
		const calls: string[] = []

		const app = new Elysia()
			.afterResponse(({ defer }) => {
				calls.push('hook')
				defer(() => calls.push('deferred'))
			})
			.get('/', () => 'ok')

		await app.handle('/')
		await Bun.sleep(1)

		// the drain snapshot is taken after the static hooks run, so a hook is
		// still allowed to enqueue
		expect(calls).toEqual(['hook', 'deferred'])
	})

	it('runs defer() registered by a static hook on the interpreted lane', async () => {
		const calls: string[] = []

		const app = new Elysia().afterResponse(({ defer }) => {
			calls.push('hook')
			defer(() => calls.push('deferred'))
		})

		await app.handle('/missing')
		await Bun.sleep(1)

		expect(calls).toEqual(['hook', 'deferred'])
	})

	it('runs defer() registered by an async static hook after it awaits', async () => {
		const jit: string[] = []
		const interpreted: string[] = []

		const app = new Elysia()
			.afterResponse(async ({ defer }) => {
				await Bun.sleep(1)
				jit.push('hook')
				defer(() => jit.push('deferred'))
			})
			.get('/', () => 'ok')

		const fallthrough = new Elysia().afterResponse(async ({ defer }) => {
			await Bun.sleep(1)
			interpreted.push('hook')
			defer(() => interpreted.push('deferred'))
		})

		await Promise.all([app.handle('/'), fallthrough.handle('/missing')])
		await Bun.sleep(10)

		// the hook is awaited before the snapshot is taken, so deferring after
		// an await is still inside the window
		expect(jit).toEqual(['hook', 'deferred'])
		expect(interpreted).toEqual(['hook', 'deferred'])
	})

	it('runs defer() registered by a promise-returning static hook', async () => {
		const jit: string[] = []
		const interpreted: string[] = []

		// deliberately NOT declared `async`: the JIT lane keyed its `await` off
		// `fn.constructor.name === 'AsyncFunction'`, so this shape was called
		// fire-and-forget and the defer() landed past the drain's length
		// snapshot — dropped, and without the warning that normally reports it
		const hook = (order: string[]) => (c: any) =>
			Bun.sleep(1).then(() => {
				order.push('hook')
				c.defer(() => order.push('deferred'))
			})

		const app = new Elysia().afterResponse(hook(jit)).get('/', () => 'ok')

		const fallthrough = new Elysia().afterResponse(hook(interpreted))

		await Promise.all([app.handle('/'), fallthrough.handle('/missing')])
		await Bun.sleep(10)

		expect(jit).toEqual(['hook', 'deferred'])
		expect(interpreted).toEqual(['hook', 'deferred'])
	})

	it('runs mixed async, promise-returning and sync hooks in registration order', async () => {
		const jit: string[] = []
		const interpreted: string[] = []

		// the promise-returning hook is registered first but resolves last, so
		// an unawaited call reorders the drain to b, c, a
		const build = (order: string[]) =>
			new Elysia()
				.afterResponse(() =>
					Bun.sleep(5).then(() => {
						order.push('a')
					})
				)
				.afterResponse(() => {
					order.push('b')
				})
				.afterResponse(async () => {
					await Bun.sleep(1)
					order.push('c')
				})

		const app = build(jit).get('/', () => 'ok')
		const fallthrough = build(interpreted)

		await Promise.all([app.handle('/'), fallthrough.handle('/missing')])
		await Bun.sleep(30)

		expect(jit).toEqual(['a', 'b', 'c'])
		expect(interpreted).toEqual(['a', 'b', 'c'])
	})

	it('runs consecutive sync hooks unchanged', async () => {
		const jit: string[] = []
		const interpreted: string[] = []

		// three sync hooks inline into one drain scope. The await guard's temp
		// is declared per hook, so a scope-shared name would be a redeclaration
		// SyntaxError and the route would fail to compile at all. `push`
		// returns a number, pinning that a non-promise return stays ignored.
		const build = (order: string[]) =>
			new Elysia()
				.afterResponse(() => {
					order.push('a')
				})
				.afterResponse(() => order.push('b'))
				.afterResponse(() => {
					order.push('c')
				})

		const app = build(jit).get('/', () => 'ok')
		const fallthrough = build(interpreted)

		await Promise.all([app.handle('/'), fallthrough.handle('/missing')])
		await Bun.sleep(1)

		expect(jit).toEqual(['a', 'b', 'c'])
		expect(interpreted).toEqual(['a', 'b', 'c'])
	})
})

describe('afterResponse after errors', () => {
	const newReq = (params?: {
		path?: string
		headers?: Record<string, string>
		method?: string
		body?: string
	}) => new Request(`http://localhost${params?.path ?? '/'}`, params)

	class CustomError extends Error {}

	let isOnResponseCalled: boolean
	let onResponseCalledCounter = 0

	beforeEach(() => {
		isOnResponseCalled = false
		onResponseCalledCounter = 0
	})

	const app = new Elysia()
		.afterResponse(() => {
			isOnResponseCalled = true
			onResponseCalledCounter++
		})
		.post(
			'/',
			{
				body: t.Object({
					test: t.String()
				})
			},
			() => 'yay'
		)
		.get('/customError', () => {
			throw new CustomError('whelp')
		})
		.get('/internalError', () => {
			throw new InternalServerError('whelp')
		})

	it.each([
		['NotFoundError', newReq({ path: '/notFound' })],
		[
			'ParseError',
			newReq({
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: ''
			})
		],
		[
			'ValidationError',
			newReq({
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({})
			})
		],
		['CustomError', newReq({ path: '/customError' })],
		['InternalServerError', newReq({ path: '/internalError' })]
	])('%s runs afterResponse once', async (_name, request) => {
		expect(isOnResponseCalled).toBeFalse()

		await app.handle(request)
		await Bun.sleep(1)

		expect(isOnResponseCalled).toBeTrue()
		expect(onResponseCalledCounter).toBe(1)
	})

	it.each([{ withOnError: true }, { withOnError: false }])(
		'runs once for a missing route (error hook: $withOnError)',
		async ({ withOnError }) => {
			let counter = 0

			const app = new Elysia().afterResponse(() => {
				counter++
			})

			if (withOnError) app.error(() => {})

			const req = new Request('http://localhost/notFound')
			await app.handle(req)
			await Bun.sleep(1)

			expect(counter).toBe(1)
		}
	)

	it.each([
		{ onErrorReturnsValue: 'error handled' },
		{ onErrorReturnsValue: { message: 'error handled' } }
	])(
		'runs once after an error hook returns $onErrorReturnsValue',
		async ({ onErrorReturnsValue }) => {
			let counter = 0

			const app = new Elysia()
				.error(() => {
					return onErrorReturnsValue
				})
				.afterResponse(() => {
					counter++
				})
				.get('/error', () => {
					throw new Error('test error')
				})

			expect(counter).toBe(0)

			const req = new Request('http://localhost/error')
			const res = await app.handle(req)
			const text = await res.text()

			expect(text).toStrictEqual(
				typeof onErrorReturnsValue === 'string'
					? onErrorReturnsValue
					: JSON.stringify(onErrorReturnsValue)
			)

			await Bun.sleep(1)

			expect(counter).toBe(1)
		}
	)
})
