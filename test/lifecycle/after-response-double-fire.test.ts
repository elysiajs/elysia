import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'

// A generator that throws before its first yield must schedule `afterResponse` once.

const settle = () => Bun.sleep(20)

const drain = async (response: Response) => {
	try {
		await response.text()
	} catch {}
}

const build = (
	config: ConstructorParameters<typeof Elysia>[0],
	handler: unknown,
	log: string[],
	withErrorHook: boolean
) =>
	new Elysia(config).get(
		'/',
		{
			afterResponse() {
				log.push('afterResponse')
			},
			...(withErrorHook
				? {
						error({ error }: any) {
							log.push(`error:${(error as Error).message}`)
						}
					}
				: {})
		},
		handler as any
	)

const lanes = [
	['jit', {}],
	['precompile', { precompile: true }]
] as const

for (const [lane, config] of lanes)
	describe(`afterResponse count (${lane})`, () => {
		it('sync generator throwing before its first yield: error then afterResponse, once', async () => {
			const log: string[] = []
			const app = build(
				config,
				function* () {
					throw new Error('boom')
				},
				log,
				true
			)

			const response = await app.handle('/')
			expect(response.status).toBe(500)
			await drain(response)
			await settle()

			expect(log).toEqual(['error:boom', 'afterResponse'])
		})

		it('async generator throwing before its first yield: error then afterResponse, once', async () => {
			const log: string[] = []
			const app = build(
				config,
				async function* () {
					throw new Error('boom')
				},
				log,
				true
			)

			const response = await app.handle('/')
			expect(response.status).toBe(500)
			await drain(response)
			await settle()

			expect(log).toEqual(['error:boom', 'afterResponse'])
		})

		it('pre-yield throw without an error hook still fires afterResponse once', async () => {
			const log: string[] = []
			const app = build(
				config,
				function* () {
					throw new Error('boom')
				},
				log,
				false
			)

			const response = await app.handle('/')
			await drain(response)
			await settle()

			expect(log).toEqual(['afterResponse'])
		})

		it('throw after the first yield fires afterResponse once', async () => {
			const log: string[] = []
			const app = build(
				config,
				function* () {
					yield 'a'
					throw new Error('boom')
				},
				log,
				true
			)

			const response = await app.handle('/')
			expect(response.status).toBe(200)
			await drain(response)
			await settle()

			expect(log).toEqual(['afterResponse'])
		})

		it('clean stream fires afterResponse once', async () => {
			const log: string[] = []
			const app = build(
				config,
				function* () {
					yield 'a'
					yield 'b'
				},
				log,
				true
			)

			const response = await app.handle('/')
			await expect(response.text()).resolves.toBe('ab')
			await settle()

			expect(log).toEqual(['afterResponse'])
		})

		it('plain throw fires error then afterResponse, once', async () => {
			const log: string[] = []
			const app = build(
				config,
				() => {
					throw new Error('boom')
				},
				log,
				true
			)

			const response = await app.handle('/')
			expect(response.status).toBe(500)
			await drain(response)
			await settle()

			expect(log).toEqual(['error:boom', 'afterResponse'])
		})

		it('cookie signing failure does not double-fire afterResponse', async () => {
			// Cookie signing fails between scheduling and response mapping.
			const log: string[] = []
			const app = new Elysia({
				...config,
				cookie: {
					secrets: 'secret',
					sign: ['session']
				}
			}).get(
				'/',
				{
					afterResponse() {
						log.push('afterResponse')
					},
					error({ error }: any) {
						log.push(`error:${(error as Error).message}`)
					}
				},
				({ cookie }: any) => {
					cookie.session.value = {
						toJSON() {
							throw new Error('unserializable')
						}
					}

					return 'ok'
				}
			)

			const response = await app.handle('/')
			await drain(response)
			await settle()

			expect(log.filter((v) => v === 'afterResponse')).toHaveLength(1)
		})

		// No error hook: a sync handler compiles to the sync afterResponse lane.
		// However the route fails, sync or async, its own hook runs once
		for (const [shape, handler] of [
			[
				'sync throw',
				() => {
					throw new Error('boom')
				}
			],
			[
				'async throw',
				async () => {
					throw new Error('boom')
				}
			],
			['returned rejection', () => Promise.reject(new Error('boom'))],
			['resolved Error', () => Promise.resolve(new Error('boom'))],
			// mapping fails after the hook was scheduled: it must not run twice
			[
				'sync mapping throw',
				() => ({
					toJSON() {
						throw new Error('boom')
					}
				})
			],
			[
				'async mapping throw',
				() =>
					Promise.resolve({
						toJSON() {
							throw new Error('boom')
						}
					})
			]
		] as const)
			it(`${shape} without an error hook fires afterResponse once`, async () => {
				const log: string[] = []
				const response = await build(
					config,
					handler,
					log,
					false
				).handle('/')
				expect(response.status).toBe(500)
				await drain(response)
				await settle()

				expect(log).toEqual(['afterResponse'])
			})

		// The sync lane tees a returned stream before it signs cookies and maps
		// it. A failure there never sends the tee's value branch, so it must be
		// stopped: otherwise the source parks at tee's cap and its own cleanup
		// (`finally`, `cancel`) never runs
		for (const [source, stream] of [
			[
				'generator',
				(log: string[]) =>
					(function* () {
						try {
							while (true) yield 'x'
						} finally {
							log.push('stopped')
						}
					})()
			],
			[
				'async iterable',
				(log: string[]) =>
					(async function* () {
						try {
							while (true) yield 'x'
						} finally {
							log.push('stopped')
						}
					})()
			],
			[
				'ReadableStream',
				(log: string[]) =>
					new ReadableStream({
						pull(controller) {
							controller.enqueue('x')
						},
						cancel() {
							log.push('stopped')
						}
					})
			]
		] as const)
			for (const [failure, cookie, fail] of [
				// throws synchronously, before mapping
				[
					'cookie signing',
					{ secrets: 'secret', sign: 'session' },
					({ cookie }: any) => {
						cookie.session.value = {
							toJSON() {
								throw new Error('sign')
							}
						}
					}
				],
				// rejects after mapping pulled the first chunk
				[
					'mapping',
					undefined,
					({ set }: any) => {
						set.status = 1000
					}
				]
			] as const)
				it(`${failure} failing stops a returned ${source} and fires afterResponse once`, async () => {
					const log: string[] = []
					const response = await new Elysia({ ...config, cookie })
						.get(
							'/',
							{
								afterResponse() {
									log.push('afterResponse')
								}
							},
							(context) => {
								fail(context)
								return stream(log)
							}
						)
						.handle('/')
					expect(response.status).toBe(500)
					await drain(response)
					await settle()

					expect(log.toSorted()).toEqual(['afterResponse', 'stopped'])
				})

		// However the route's error hook settles, the route's own afterResponse
		// runs once. A throwing hook used to fall to the app-level error lane,
		// which runs only the root chain (here: the global registered after
		// the route), never the route's hook
		for (const [handlerShape, handler] of [
			[
				'sync throw',
				() => {
					throw new Error('boom')
				}
			],
			[
				'async throw',
				async () => {
					throw new Error('boom')
				}
			],
			// non-async rejections compile to the async tail (`_t`) on Bun
			['returned rejection', () => Promise.reject(new Error('boom'))]
		] as const)
			for (const [hookShape, error] of [
				[
					'throwing',
					() => {
						throw new Error('hook')
					}
				],
				[
					'rejecting',
					async () => {
						throw new Error('hook')
					}
				],
				[
					'rejection-returning',
					() => Promise.reject(new Error('hook'))
				],
				['returning', () => 'handled'],
				// the hook already scheduled afterResponse, then mapping throws
				[
					'returning an unmappable value from',
					() => ({
						toJSON() {
							throw new Error('hook')
						}
					})
				]
			] as const)
				it(`${hookShape} error hook on ${handlerShape} fires the route afterResponse once`, async () => {
					const log: string[] = []
					const response = await new Elysia(config)
						.get(
							'/',
							{
								afterResponse() {
									log.push('afterResponse')
								},
								error: error as any
							},
							handler as any
						)
						.onAfterResponse('global', () => {
							log.push('global')
						})
						.handle('/')
					expect(response.status).toBe(500)
					await drain(response)
					await settle()

					expect(log).toEqual(['afterResponse'])
				})
	})

describe('afterResponse count (dispatch lane)', () => {
	it('an app-level hook fires once for a pre-yield generator throw', async () => {
		const log: string[] = []
		const app = new Elysia()
			.onAfterResponse(() => {
				log.push('afterResponse')
			})
			.onError(({ error }) => {
				log.push(`error:${(error as Error).message}`)
			})
			.get('/', function* () {
				throw new Error('boom')
			})

		const response = await app.handle('/')
		expect(response.status).toBe(500)
		await drain(response)
		await settle()

		expect(log).toEqual(['error:boom', 'afterResponse'])
	})

	it('an app-level hook fires once for an unmatched route', async () => {
		const log: string[] = []
		const app = new Elysia()
			.onAfterResponse(() => {
				log.push('afterResponse')
			})
			.get('/', () => 'ok')

		const response = await app.handle('/nope')
		expect(response.status).toBe(404)
		await drain(response)
		await settle()

		expect(log).toEqual(['afterResponse'])
	})
})
