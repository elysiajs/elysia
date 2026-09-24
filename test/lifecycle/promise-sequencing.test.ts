import '../../src/compile/aot-capture'
import { afterEach, describe, expect, it } from 'bun:test'
import { runInNewContext } from 'node:vm'
import { Elysia, t } from '../../src'
import { origin } from '../../src/adapter/origin'
import { defaultAdapter } from '../../src/adapter/constants'
import { trace } from '../../src/plugin/trace'
import { Compiled } from '../../src/compile/aot'
import {
	endHandlerCapture,
	endValidatorCapture
} from '../../src/compile/aot-capture'
import { mayReturnPromise } from '../../src/compile/utils'
import { Validator } from '../../src/validator'
import {
	materialise,
	materialiseHandlers,
	registerManifest
} from '../aot/_manifest'

afterEach(() => {
	Compiled.clear()
	Validator.clear()
})

const buildMode = (mode: string, build: () => any) => {
	if (mode === 'lazy') return build()
	if (mode === 'eager') return build().compile()

	const previous = process.env.ELYSIA_AOT_BUILD
	try {
		process.env.ELYSIA_AOT_BUILD = '1'
		endHandlerCapture()
		endValidatorCapture()
		build().compile()
		const handlers = endHandlerCapture()
		const validators = endValidatorCapture()
		expect(handlers.length).toBeGreaterThan(0)
		delete process.env.ELYSIA_AOT_BUILD
		Validator.clear()
		registerManifest({
			handlers: materialiseHandlers(handlers),
			validators: materialise(validators)
		})
		return build().compile()
	} finally {
		if (previous === undefined) delete process.env.ELYSIA_AOT_BUILD
		else process.env.ELYSIA_AOT_BUILD = previous
		endHandlerCapture()
		endValidatorCapture()
	}
}

const callbacks: Record<string, (p: Promise<void>) => (...args: any[]) => any> =
	{
		captured: (p) => () => p,
		computed: (p) => {
			const values = [p]
			return () => values[0]
		},
		conditional: (p) => (c) => (c.request.method === 'GET' ? p : undefined),
		parenthesized: (p) => new Function('p', 'return () => (p)')(p),
		optional: (p) => {
			const fn = () => p
			return () => fn?.()
		},
		bound: (p) =>
			function () {
				return p
			}.bind(null),
		native: (p) => Promise.resolve.bind(Promise, p),
		forged: (p) => Object.assign(() => p, { toString: () => '() => {}' })
	}

for (const mode of ['lazy', 'eager', 'frozen'])
	describe(`${mode} promise hook sequencing`, () => {
		for (const [shape, callback] of Object.entries(callbacks))
			for (const phase of [
				'request',
				'tracedRequest',
				'transform',
				'beforeHandle',
				'afterHandle',
				'mapResponse',
				'error',
				'notFound'
			])
				it(`${phase} awaits ${shape} before deciding whether to continue`, async () => {
					const order: string[] = []
					let release!: () => void
					const p = new Promise<void>((resolve) => {
						release = resolve
					}).then(() => {
						order.push('settled')
					})
					const hook = callback(p)
					const next = () => {
						order.push('next')
					}
					const app = buildMode(mode, () => {
						const app = new Elysia()
						if (phase === 'tracedRequest')
							app.use(trace()).trace(({ onRequest }) => {
								onRequest(({ onStop }) => {
									onStop(() => {
										order.push('trace-stop')
									})
								})
							})
						if (phase === 'request' || phase === 'tracedRequest')
							app.request([hook, next])
						const error = phase === 'error' || phase === 'notFound'
						if (error)
							app.error(hook).error(() => {
								next()
								return 'handled'
							})
						const options = [
							'transform',
							'beforeHandle',
							'afterHandle',
							'mapResponse'
						].includes(phase)
							? { [phase]: [hook, next] }
							: {}
						return app.get(
							'/',
							options as any,
							error
								? () => {
										throw new Error('original')
									}
								: () => 'handler'
						)
					})
					const pending = app.handle(
						phase === 'notFound' ? '/missing' : '/'
					)
					expect(order).toEqual([])
					release()
					const response = await pending
					await expect(response.text()).resolves.toBe(
						phase === 'error' || phase === 'notFound'
							? 'handled'
							: 'handler'
					)
					expect(order).toEqual(
						phase === 'tracedRequest'
							? ['settled', 'next', 'trace-stop']
							: ['settled', 'next']
					)
				})

		for (const foreign of [false, true])
			it(`awaits ${foreign ? 'cross-realm Promise' : 'plain thenable'} results throughout parsing and observed handlers`, async () => {
				const promise = (value: unknown): any =>
					foreign
						? runInNewContext('Promise.resolve(value)', { value })
						: {
								then(resolve: (value: unknown) => void) {
									resolve(value)
								}
							}
				const app = buildMode(mode, () =>
					new Elysia()
						.request(() => promise(undefined))
						.post(
							'/',
							{
								parse: () => promise({ n: 1 }),
								body: t.Object({ n: t.Number() }),
								transform: () => promise(undefined),
								beforeHandle: () => promise(undefined),
								afterHandle: ({ responseValue }: any) => {
									expect(responseValue).toBe('handler')
									return promise(undefined)
								},
								mapResponse: () => promise(undefined)
							},
							() => promise('handler')
						)
				)
				const response = await app.handle('/', {
					method: 'POST',
					body: '{}'
				})
				expect(response.status).toBe(200)
				await expect(response.text()).resolves.toBe('handler')
			})

		it('validates parameters only after a captured transform promise settles', async () => {
			let release!: () => void
			const ready = new Promise<void>((resolve) => {
				release = resolve
			})
			const app = buildMode(mode, () =>
				new Elysia().get(
					'/:id',
					{
						params: t.Object({ id: t.Literal('ready') }),
						transform: ((c: any) =>
							ready.then(() => {
								c.params.id = 'ready'
							})).bind(null)
					},
					({ params }) => params.id
				)
			)
			const pending = app.handle('/pending')
			release()
			const response = await pending
			expect(response.status).toBe(200)
			await expect(response.text()).resolves.toBe('ready')
		})

		it('awaits cross-realm error hooks on both routed and missing requests', async () => {
			const p = runInNewContext('Promise.resolve(undefined)')
			const app = buildMode(mode, () =>
				new Elysia()
					.error(() => p)
					.error(() => 'handled')
					.get('/', () => {
						throw new Error('original')
					})
			)
			for (const path of ['/', '/missing'])
				await expect((await app.handle(path)).text()).resolves.toBe(
					'handled'
				)
		})

		it('gives afterResponse the resolved cross-realm handler value', async () => {
			const p = runInNewContext('Promise.resolve("handler")')
			const values: unknown[] = []
			let finished!: () => void
			const done = new Promise<void>((resolve) => {
				finished = resolve
			})
			const app = buildMode(mode, () =>
				new Elysia()
					.afterResponse(({ responseValue }) => {
						values.push(responseValue)
						finished()
					})
					.get('/', () => p)
			)
			await expect((await app.handle('/')).text()).resolves.toBe(
				'handler'
			)
			await done
			expect(values).toEqual(['handler'])
		})

		for (const path of ['bare', 'set', 'headers', 'before', 'error'])
			it(`forwards a cross-realm resolved Error through the ${path} handler`, async () => {
				const error = Object.assign(new Error('teapot'), {
					status: 418
				})
				const p = runInNewContext('Promise.resolve(error)', { error })
				const app = buildMode(mode, () => {
					const app = new Elysia()
					if (path === 'headers') app.headers({ 'x-default': 'yes' })
					if (path === 'before') app.beforeHandle(() => {})
					if (path === 'error') app.error(() => 'caught')
					return app.get(
						'/',
						path === 'set'
							? ({ set }) => {
									set.headers['x-set'] = 'yes'
									return p
								}
							: () => p
					)
				})
				const response = await app.handle('/')
				expect(response.status).toBe(418)
				await expect(response.text()).resolves.toBe(
					path === 'error' ? 'caught' : 'teapot'
				)
			})

		it('assimilates a bare handler thenable like an async handler', async () => {
			const value = {
				then(resolve: (value: string) => void) {
					resolve('handler')
				}
			}
			const app = buildMode(mode, () =>
				new Elysia().get('/', () => value)
			)
			await expect((await app.handle('/')).text()).resolves.toBe(
				'handler'
			)
		})

		it('routes a rejecting captured transform promise through error hooks', async () => {
			let reject!: (reason: Error) => void
			const p = new Promise<void>((_, rejectPromise) => {
				reject = rejectPromise
			})
			const app = buildMode(mode, () =>
				new Elysia()
					.error(({ error }) => error.message)
					.get('/', { transform: () => p }, () => 'wrong')
			)
			const pending = app.handle('/')
			reject(new Error('transform rejected'))
			const response = await pending
			expect(response.status).toBe(500)
			await expect(response.text()).resolves.toBe('transform rejected')
		})

		it('routes a throwing then getter through the error pipeline', async () => {
			const value = {
				get then() {
					throw new Error('then getter')
				}
			}
			const app = buildMode(mode, () =>
				new Elysia()
					.error(({ error }) => error.message)
					.get('/', { beforeHandle: () => value }, () => 'wrong')
			)
			const response = await app.handle('/')
			expect(response.status).toBe(500)
			await expect(response.text()).resolves.toBe('then getter')
		})

		for (const phase of ['request', 'transform', 'beforeHandle'])
			it(`stops ${phase} after a captured promise aborts the request`, async () => {
				const controller = new AbortController()
				let release!: () => void
				const p = new Promise<void>((resolve) => {
					release = resolve
				}).then(() => controller.abort())
				let next = false
				const hooks = [
					() => p,
					() => {
						next = true
					}
				]
				const app = buildMode(mode, () => {
					const app = new Elysia()
					if (phase === 'request') app.request(hooks)
					return app.get(
						'/',
						phase === 'request' ? {} : { [phase]: hooks },
						() => 'wrong'
					)
				})
				const pending = app.handle('/', { signal: controller.signal })
				release()
				await expect((await pending).text()).resolves.toBe('')
				expect(next).toBe(false)
			})
	})

it('keeps proved non-returning hooks and a hook-free route synchronous', () => {
	const calls: string[] = []
	const app = new Elysia()
		.request(() => {
			calls.push('request')
		})
		.beforeHandle(function before() {
			calls.push('before')
		})
		.get('/', () => 'ok')
	expect(app.fetch(new Request('http://localhost/'))).toBeInstanceOf(Response)
	expect(calls).toEqual(['request', 'before'])
	expect(
		new Elysia()
			.get('/', () => 'ok')
			.fetch(new Request('http://localhost/'))
	).toBeInstanceOf(Response)
})

it('awaits cross-realm promises in an eager compact beforeHandle prefix', async () => {
	const p = runInNewContext('Promise.resolve(undefined)')
	const calls: string[] = []
	const first = new Elysia()
		.beforeHandle('plugin', (() => p).bind(null))
		.get('/first', () => 'first')
	const second = new Elysia()
		.beforeHandle('plugin', () => {
			calls.push('second')
		})
		.get('/second', () => 'second')
	const app = new Elysia().use(first).use(second)
	;(app as any).compile()
	const routeIndex = app.routes.findIndex(({ path }) => path === '/second')
	expect((app as any).handler(routeIndex, true).toString()).toContain('rbp')
	await expect((await app.handle('/second')).text()).resolves.toBe('second')
	expect(calls).toEqual(['second'])
})

it('never proves async, bound, or complex headers synchronous', () => {
	for (const callback of [
		async () => {},
		(() => {}).bind(null),
		(_fn = () => {}) => {},
		new Function('return Promise.resolve()')
	])
		expect(mayReturnPromise(callback)).toBe(true)
	expect(
		mayReturnPromise(({ set }: any) => {
			set.status = 201
		})
	).toBe(false)
})

// Publish provenance only for fetch's synchronous entry, exactly as the Bun
// adapter does. A getter counter catches allocation even when the slot is cold
// at the first hook but accidentally warmed by a later generated guard.
const nativeDispatch = (app: any, init: RequestInit = {}, path = '/') => {
	let reads = 0
	class ObservedRequest extends Request {
		get signal() {
			reads++
			return super.signal
		}
	}
	const request = new ObservedRequest(`http://localhost${path}`, init)
	const fetch = app.fetch
	origin.request = request
	let pending: Response | Promise<Response>
	try {
		pending = fetch(request)
	} finally {
		origin.request = undefined
	}
	return { pending, reads: () => reads }
}

for (const mode of ['lazy', 'eager', 'frozen'])
	describe(`${mode} native await boundaries`, () => {
		for (const phase of [
			'request',
			'tracedRequest',
			'transform',
			'derive',
			'beforeHandle',
			'afterHandle',
			'mapResponse',
			'handler',
			'parse',
			'error'
		])
			for (const shape of ['immediate', 'promise', 'async'])
				for (const cancel of shape === 'immediate'
					? [false]
					: [false, true])
					it(`${phase} ${shape} ${cancel ? 'cancels' : 'continues'} with signal arming at the actual await`, async () => {
						const controller = new AbortController()
						let release!: () => void
						const gate = new Promise<void>((resolve) => {
							release = resolve
						})
						let context: any
						let next = false
						let resumed = false
						const result =
							phase === 'derive'
								? { answer: 42 }
								: phase === 'parse'
									? { n: 1 }
									: phase === 'handler'
										? 'ok'
										: undefined
						const enter = (c: any) => {
							context = c
							expect(c['~sig']).toBeUndefined()
						}
						const resume = () => {
							resumed = true
							expect(context['~sig']).toBeInstanceOf(AbortSignal)
							expect(context['~sig'].aborted).toBe(cancel)
							return result
						}
						const hook =
							shape === 'async'
								? async (c: any) => {
										enter(c)
										await gate
										return resume()
									}
								: (c: any) => {
										enter(c)
										return shape === 'immediate'
											? result
											: gate.then(resume)
									}
						const follow = () => {
							next = true
						}
						const app = buildMode(mode, () => {
							const app = new Elysia()
							if (phase === 'tracedRequest')
								app.use(trace()).trace(({ onRequest }) => {
									onRequest(({ onStop }) => {
										onStop(() => {})
									})
								})
							if (
								phase === 'request' ||
								phase === 'tracedRequest'
							)
								app.request([hook, follow])
							else if (phase === 'derive')
								app.derive(hook as any).beforeHandle(follow)
							else if (phase === 'handler')
								app.afterHandle(follow)
							else if (phase === 'parse')
								app.parse(hook).beforeHandle(follow)
							else if (phase === 'error')
								app.error(hook).error(() => {
									follow()
									return 'ok'
								})
							else (app as any)[phase]([hook, follow])
							const handler =
								phase === 'handler'
									? hook
									: phase === 'error'
										? () => {
												throw new Error('original')
											}
										: () => 'ok'
							return phase === 'parse'
								? app.post(
										'/',
										{ body: t.Object({ n: t.Number() }) },
										handler as any
									)
								: app.get('/', handler as any)
						})
						const request = nativeDispatch(app, {
							signal: controller.signal,
							...(phase === 'parse'
								? { method: 'POST', body: '{}' }
								: {})
						})
						if (shape !== 'immediate') {
							expect(next).toBe(false)
							expect(request.reads()).toBe(1)
							if (cancel) controller.abort()
							release()
						}
						const response = await request.pending
						await expect(response.text()).resolves.toBe(
							cancel ? '' : 'ok'
						)
						expect(next).toBe(!cancel)
						expect(resumed).toBe(shape !== 'immediate')
						// Error finalization deliberately retains its conservative catch arm.
						expect(request.reads()).toBe(
							shape !== 'immediate' || phase === 'error' ? 1 : 0
						)
					})
	})

for (const mode of ['lazy', 'eager', 'frozen'])
	describe(`${mode} direct await boundaries`, () => {
		for (const parser of [
			'json',
			'text',
			'formdata',
			'urlencoded',
			'arrayBuffer',
			'default-json',
			'default-text'
		])
			for (const promised of [false, true])
				it(`${parser} captures its ${promised ? 'Promise' : 'immediate'} operand before arming and cancels after await`, async () => {
					const controller = new AbortController()
					let release!: () => void
					const gate = new Promise<void>((resolve) => {
						release = resolve
					})
					let next = false
					const parse = (c: any) => {
						expect(c['~sig']).toBeUndefined()
						return promised
							? gate.then(() => {
									expect(c['~sig']).toBeInstanceOf(
										AbortSignal
									)
									return { n: 1 }
								})
							: { n: 1 }
					}
					const app = buildMode(mode, () =>
						new Elysia({
							adapter: {
								...defaultAdapter,
								parse: {
									json: parse,
									text: parse as any,
									formData: parse,
									urlencoded: parse as any,
									arrayBuffer: parse as any,
									default: parse
								}
							}
						})
							.beforeHandle(() => {
								next = true
							})
							.post(
								'/',
								parser.startsWith('default')
									? {}
									: { parse: parser as any },
								({ body }) => (body ? 'ok' : 'missing')
							)
					)
					const request = nativeDispatch(app, {
						method: 'POST',
						body: '{}',
						signal: controller.signal,
						headers: {
							'content-type':
								parser === 'default-text'
									? 'text/plain'
									: 'application/json'
						}
					})
					expect(request.reads()).toBe(1)
					controller.abort()
					release()
					await expect((await request.pending).text()).resolves.toBe(
						''
					)
					expect(next).toBe(false)
					expect(request.reads()).toBe(1)
				})

		it('keeps skipped default parsing cold', async () => {
			const app = buildMode(mode, () =>
				new Elysia()
					.beforeHandle(() => {})
					.post('/', ({ body }) =>
						body === undefined ? 'ok' : 'wrong'
					)
			)
			const request = nativeDispatch(app, { method: 'POST' })
			await expect((await request.pending).text()).resolves.toBe('ok')
			expect(request.reads()).toBe(0)
		})

		for (const slot of [
			'body',
			'headers',
			'params',
			'query',
			'cookie',
			'response',
			'response-status'
		])
			for (const promised of [false, true])
				it(`${slot} arms for its explicitly awaited ${promised ? 'Promise' : 'immediate'} validator result`, async () => {
					const controller = new AbortController()
					let context: any
					let release!: () => void
					let entered!: () => void
					const enteredPromise = new Promise<void>((resolve) => {
						entered = resolve
					})
					const gate = new Promise<void>((resolve) => {
						release = resolve
					})
					const schema = {
						'~standard': {
							version: 1,
							vendor: 'await-boundary',
							validate(value: any) {
								// Async cookie validation first awaits raw parsing; every other
								// slot reaches its first user validator while still cold.
								expect(context['~sig'] === undefined).toBe(
									slot !== 'cookie'
								)
								entered()
								return promised
									? gate.then(() => {
											expect(
												context['~sig']
											).toBeInstanceOf(AbortSignal)
											return { value }
										})
									: { value }
							}
						}
					}
					const responseSlot = slot.startsWith('response')
					const options = {
						[responseSlot ? 'response' : slot]:
							slot === 'response-status'
								? { 201: schema }
								: schema,
						...(slot === 'body' ? { parse: () => ({ n: 1 }) } : {})
					}
					const app = buildMode(mode, () => {
						const app = new Elysia().transform((c) => {
							context = c
						})
						const handler =
							slot === 'response-status'
								? ({ status }: any) => status(201, 'ok')
								: () => 'ok'
						return slot === 'body'
							? app.post('/:id', options as any, handler)
							: app.get('/:id', options as any, handler)
					})
					const request = nativeDispatch(
						app,
						{
							signal: controller.signal,
							headers: { cookie: 'id=one' },
							...(slot === 'body'
								? { method: 'POST', body: '{}' }
								: {})
						},
						'/one?q=value'
					)
					if (promised) {
						await enteredPromise
						expect(request.reads()).toBe(1)
						controller.abort()
						release()
					}
					await expect((await request.pending).text()).resolves.toBe(
						promised ? '' : 'ok'
					)
					expect(request.reads()).toBe(1)
				})

		it('does not arm disabled cancellation even after awaiting lifecycle hooks', async () => {
			const app = buildMode(mode, () =>
				new Elysia({ abortSignal: false })
					.request(async () => {})
					.transform(async () => {})
					.beforeHandle(async () => {})
					.get('/', async () => 'ok')
			)
			const controller = new AbortController()
			controller.abort()
			const request = nativeDispatch(app, { signal: controller.signal })
			await expect((await request.pending).text()).resolves.toBe('ok')
			expect(request.reads()).toBe(0)
		})
	})

for (const mode of ['lazy', 'eager', 'frozen']) {
	for (const promised of [false, true])
		it(`${mode} ${promised ? 'Promise' : 'immediate'} propagated prefix preserves await boundaries`, async () => {
			const controller = new AbortController()
			let release!: () => void
			const gate = new Promise<void>((resolve) => {
				release = resolve
			})
			let next = false
			const order: string[] = []
			const hook = (c: any) => {
				order.push('first')
				expect(c['~sig']).toBeUndefined()
				return promised
					? gate.then(() => {
							expect(c['~sig']).toBeInstanceOf(AbortSignal)
						})
					: undefined
			}
			const app = buildMode(mode, () =>
				new Elysia()
					.use(
						new Elysia()
							.beforeHandle('plugin', hook)
							.get('/first', () => 'first')
					)
					.use(
						new Elysia()
							.beforeHandle('plugin', () => {
								next = true
								order.push('second')
							})
							.get('/second', () => 'ok')
					)
			)
			const request = nativeDispatch(
				app,
				{ signal: controller.signal },
				'/second'
			)
			expect(order.filter((phase) => phase === 'first')).toHaveLength(1)
			expect(request.reads()).toBe(mode === 'frozen' && !promised ? 0 : 1)
			if (promised) controller.abort()
			release()
			const response = await request.pending
			expect(response.status).toBe(200)
			await expect(response.text()).resolves.toBe(promised ? '' : 'ok')
			expect(order).toEqual(promised ? ['first'] : ['first', 'second'])
			expect(next).toBe(!promised)
		})

	it(`${mode} arms the selected synchronous EncodeFrom branch in a mixed response table`, async () => {
		const app = buildMode(mode, () =>
			new Elysia()
				.beforeHandle(() => {})
				.get(
					'/',
					{
						response: {
							200: t.String(),
							201: {
								'~standard': {
									version: 1,
									vendor: 'unused',
									validate: (value: any) => ({ value })
								}
							}
						}
					},
					() => 'ok'
				)
		)
		const request = nativeDispatch(app)
		await expect((await request.pending).text()).resolves.toBe('ok')
		expect(request.reads()).toBe(1)
	})
}

it('keeps asynchronous cookie parsing and signing helper scopes valid with WebCrypto', async () => {
	const child = Bun.spawn(
		[process.execPath, import.meta.dir + '/async-cookie-arming.fixture.ts'],
		{
			stdout: 'pipe',
			stderr: 'pipe'
		}
	)
	const timeout = setTimeout(() => child.kill(), 5_000)
	try {
		const [exit, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text()
		])
		expect(stderr).toBe('')
		expect(exit).toBe(0)
		expect(stdout.trim()).toBe('9 cookie boundary cases passed')
	} finally {
		clearTimeout(timeout)
	}
}, 10_000)
