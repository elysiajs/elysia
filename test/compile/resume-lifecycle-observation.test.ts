import { describe, expect, it } from 'bun:test'

import { Elysia, NotFound } from '../../src'
import { routePlans } from '../../src/compile/handler'
import { resumeEmit } from '../../src/experimental/resume'

const request = () => new Request('http://localhost/')
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('resume lifecycle observation', () => {
	it('materializes an initialized NotFound before a missing-route hook', async () => {
		let calls = 0
		let observed: unknown
		const app = new Elysia({ experimental: { resumeEmit } })
			.error(({ error }) => {
				calls++
				observed = error
				return 'custom missing'
			})
			.get('/', () => 'ok')

		const response = await app.handle(
			new Request('http://localhost/missing')
		)
		expect(response.status).toBe(404)
		expect(await response.text()).toBe('custom missing')
		expect(calls).toBe(1)
		expect(observed).toBeInstanceOf(NotFound)
		expect((observed as NotFound).message).toBe('Not Found')
		expect((observed as NotFound).stack).toContain('NotFound')
	})

	it('runs a synchronous error hook immediately with an initialized error', async () => {
		const order: string[] = []
		let observed: unknown

		const app = new Elysia({ experimental: { resumeEmit } }).get(
			'/',
			{
				error(context: any) {
					order.push('error')
					observed = context.error
					context.set.headers['x-error'] = 'seen'
					return 'handled'
				}
			} as any,
			() => {
				order.push('handler')
				throw new NotFound('missing')
			}
		)

		const pending = app.handle(request())
		expect(order).toEqual(['handler', 'error'])
		expect(observed).toBeInstanceOf(NotFound)
		expect((observed as NotFound).status).toBe(404)
		expect((observed as NotFound).message).toBe('missing')

		const response = await pending
		expect(response.status).toBe(404)
		expect(response.headers.get('x-error')).toBe('seen')
		expect(await response.text()).toBe('handled')
	})

	it('awaits error hooks in order and schedules afterResponse exactly once', async () => {
		const order: string[] = []

		const app = new Elysia({ experimental: { resumeEmit } }).get(
			'/',
			{
				error: [
					async () => {
						order.push('error-1:start')
						await Promise.resolve()
						order.push('error-1:end')
					},
					() => {
						order.push('error-2')
						return 'recovered'
					}
				],
				afterResponse: async () => {
					order.push('after:start')
					await Promise.resolve()
					order.push('after:end')
				}
			} as any,
			() => {
				throw new Error('boom')
			}
		)

		const response = await app.handle(request())
		expect(await response.text()).toBe('recovered')
		await flush()

		expect(order).toEqual([
			'error-1:start',
			'error-1:end',
			'error-2',
			'after:start',
			'after:end'
		])
	})

	it('matches JIT toResponse fallback without route mapResponse hooks', async () => {
		const observe = async (experimental: any) => {
			let toResponse = 0
			let mapResponse = 0
			const error = Object.assign(new Error('teapot'), {
				status: 418,
				toResponse() {
					toResponse++
					return new Response('tea', { status: 418 })
				}
			})
			const app = new Elysia({ experimental }).get(
				'/',
				{
					error: () => undefined,
					mapResponse: () => {
						mapResponse++
					}
				} as any,
				() => {
					throw error
				}
			)

			const response = await app.handle(request())
			return {
				status: response.status,
				body: await response.text(),
				toResponse,
				mapResponse
			}
		}

		const expected = await observe({})
		const actual = await observe({ resumeEmit })
		expect(actual).toEqual(expected)
		expect(actual).toEqual({
			status: 418,
			body: 'tea',
			toResponse: 1,
			mapResponse: 0
		})
	})

	it('does not turn a synchronous toResponse fallback into a cancellation boundary', async () => {
		const observe = async (experimental: any) => {
			const controller = new AbortController()
			const error = Object.assign(new Error('teapot'), {
				status: 418,
				toResponse() {
					queueMicrotask(() => controller.abort())
					return new Response('tea', { status: 418 })
				}
			})
			const app = new Elysia({ experimental }).get(
				'/',
				{ error: () => undefined } as any,
				() => {
					throw error
				}
			)

			const response = await app.handle(
				new Request('http://localhost/', { signal: controller.signal })
			)
			return { status: response.status, body: await response.text() }
		}

		const expected = await observe({})
		const actual = await observe({ resumeEmit })
		expect(actual).toEqual(expected)
		expect(actual).toEqual({ status: 418, body: 'tea' })
	})

	it('assimilates a custom toResponse thenable once', async () => {
		let toResponse = 0
		let then = 0
		let mapResponse = 0
		let afterResponse = 0
		const error = Object.assign(new Error('teapot'), {
			status: 418,
			toResponse() {
				toResponse++
				return {
					then(resolve: (value: Response) => void) {
						then++
						resolve(new Response('tea', { status: 418 }))
						resolve(new Response('ignored', { status: 419 }))
					}
				}
			}
		})

		const app = new Elysia({ experimental: { resumeEmit } }).get(
			'/',
			{
				error: () => undefined,
				mapResponse: () => {
					mapResponse++
				},
				afterResponse: () => {
					afterResponse++
				}
			} as any,
			() => {
				throw error
			}
		)

		const response = await app.handle(request())
		expect(response.status).toBe(418)
		expect(await response.text()).toBe('tea')
		await flush()

		expect(toResponse).toBe(1)
		expect(then).toBe(1)
		expect(mapResponse).toBe(0)
		expect(afterResponse).toBe(1)
	})

	it('falls back when a custom toResponse thenable rejects', async () => {
		let then = 0
		const error = Object.assign(new Error('original'), {
			status: 418,
			toResponse() {
				return {
					then(
						_resolve: (value: Response) => void,
						reject: (reason: Error) => void
					) {
						then++
						reject(new Error('inner'))
					}
				}
			}
		})

		const app = new Elysia({ experimental: { resumeEmit } }).get(
			'/',
			{ error: () => undefined } as any,
			() => {
				throw error
			}
		)

		const response = await app.handle(request())
		expect(response.status).toBe(418)
		expect(await response.text()).toBe('original')
		expect(then).toBe(1)
	})

	it('falls back when the toResponse then getter throws', async () => {
		let then = 0
		const error = Object.assign(new Error('original'), {
			status: 418,
			toResponse() {
				return {
					get then() {
						then++
						throw new Error('inner')
					}
				}
			}
		})

		const app = new Elysia({ experimental: { resumeEmit } }).get(
			'/',
			{ error: () => undefined } as any,
			() => {
				throw error
			}
		)

		const response = await app.handle(request())
		expect(response.status).toBe(418)
		expect(await response.text()).toBe('original')
		expect(then).toBe(1)
	})

	it('closes direct error fallbacks and schedules once like JIT', async () => {
		const observe = async (experimental: any, thrown: unknown) => {
			let errorStops = 0
			let afterResponse = 0
			let mapResponse = 0
			const app = new Elysia({ experimental })
				.trace(({ onError }) => {
					onError(({ onStop }) => onStop(() => errorStops++))
				})
				.get(
					'/',
					{
						mapResponse: () => {
							mapResponse++
						},
						afterResponse: () => {
							afterResponse++
						}
					} as any,
					() => {
						throw thrown
					}
				)

			const response = await app.handle(request())
			const result = {
				status: response.status,
				body: await response.text()
			}
			await flush()
			return { ...result, errorStops, afterResponse, mapResponse }
		}

		for (const thrown of [null, {}, new Error('boom')]) {
			const expected = await observe({}, thrown)
			const actual = await observe({ resumeEmit }, thrown)
			expect(actual).toEqual(expected)
			expect(actual.errorStops).toBe(1)
			expect(actual.afterResponse).toBe(1)
			expect(actual.mapResponse).toBe(0)
		}
	})

	it('maps generic fallbacks without running route mapResponse hooks', async () => {
		const observe = async (experimental: any) => {
			let errorStops = 0
			let afterResponse = 0
			let mapResponse = 0
			const app = new Elysia({ experimental })
				.trace(({ onError }) => {
					onError(({ onStop }) => onStop(() => errorStops++))
				})
				.get(
					'/',
					{
						beforeHandle({ set }: any) {
							set.headers['x-route'] = 'yes'
						},
						error: () => undefined,
						mapResponse: () => {
							mapResponse++
						},
						afterResponse: () => {
							afterResponse++
						}
					} as any,
					() => {
						throw {}
					}
				)

			const response = await app.handle(request())
			const result = {
				status: response.status,
				header: response.headers.get('x-route'),
				body: await response.text()
			}
			await flush()

			return {
				...result,
				errorStops,
				afterResponse,
				mapResponse
			}
		}

		const expected = await observe({})
		const actual = await observe({ resumeEmit })
		expect(actual).toEqual(expected)
		expect(actual).toEqual({
			status: 500,
			header: 'yes',
			body: JSON.stringify({
				type: 'internal-server-error',
				title: 'Internal Server Error',
				status: 500
			}),
			errorStops: 1,
			afterResponse: 1,
			mapResponse: 0
		})
	})

	it('reports error-hook children and their synchronous mutations', async () => {
		const order: string[] = []
		const app = new Elysia({ experimental: { resumeEmit } })
			.trace(({ onError, context }) => {
				onError(({ onEvent, onStop }) => {
					order.push('error:begin')
					onEvent(({ name, onStop: onChildStop }) => {
						order.push(`error:${name}:begin`)
						onChildStop(() => order.push(`error:${name}:end`))
					})
					onStop(() => order.push('error:end'))
					;(context as any).tracedError = true
				})
			})
			.get(
				'/',
				{
					error: function recover(context: any) {
						order.push(`hook:${context.tracedError}`)
						return 'recovered'
					}
				} as any,
				() => {
					throw new Error('boom')
				}
			)

		expect(await (await app.handle(request())).text()).toBe('recovered')
		expect(order).toEqual([
			'error:begin',
			'error:recover:begin',
			'hook:true',
			'error:recover:end',
			'error:end'
		])
	})

	it('stops the error pipeline when an async error hook rejects', async () => {
		const order: string[] = []
		const app = new Elysia({ experimental: { resumeEmit } })
			.trace(({ onError }) => {
				onError(({ onEvent, onStop }) => {
					onEvent(({ onStop: onChildStop }) =>
						onChildStop(({ error }) =>
							order.push(`child:${error?.message}`)
						)
					)
					onStop(({ error }) => order.push(`error:${error?.message}`))
				})
			})
			.get(
				'/',
				{
					error: [
						async () => {
							order.push('hook:start')
							await Promise.resolve()
							throw new Error('hook failed')
						},
						() => order.push('hook:skipped')
					]
				} as any,
				() => {
					throw new Error('route failed')
				}
			)

		const response = await app.handle(request())
		expect(response.status).toBe(500)
		expect(order).toEqual([
			'hook:start',
			'child:hook failed',
			'error:hook failed'
		])
	})

	it('makes trace mutations visible synchronously and preserves child order', async () => {
		const order: string[] = []

		const app = new Elysia({ experimental: { resumeEmit } })
			.trace(({ onHandle, context }) => {
				order.push('listener')
				onHandle(({ onEvent, onStop }) => {
					order.push('handle:begin')
					;(context as any).fromTrace = 'visible'
					onEvent(({ name, onStop: onChildStop }) => {
						order.push(`child:${name}:begin`)
						onChildStop(() => order.push(`child:${name}:end`))
					})
					onStop(() => order.push('handle:end'))
				})
			})
			.get('/', function route(context: any) {
				order.push(`handler:${context.fromTrace}`)
				return 'ok'
			})

		const pending = app.handle(request())
		expect(order).toEqual([
			'listener',
			'handle:begin',
			'child:route:begin',
			'handler:visible',
			'child:route:end',
			'handle:end'
		])
		expect(await (await pending).text()).toBe('ok')
	})

	it('keeps traced beforeHandle short-circuits guarded like JIT', async () => {
		const observe = async (experimental: any) => {
			const order: string[] = []
			const trace: string[] = []
			const app = new Elysia({ experimental })
				.trace(({ onBeforeHandle, onHandle }) => {
					onBeforeHandle(({ onEvent, onStop }) => {
						trace.push('beforeHandle:begin')
						onEvent(({ name, onStop }) => {
							trace.push(`beforeHandle:${name}:begin`)
							onStop(() => trace.push(`beforeHandle:${name}:end`))
						})
						onStop(() => trace.push('beforeHandle:end'))
					})
					onHandle(({ onEvent, onStop }) => {
						trace.push('handle:begin')
						onEvent(({ name, onStop }) => {
							trace.push(`handle:${name}:begin`)
							onStop(() => trace.push(`handle:${name}:end`))
						})
						onStop(() => trace.push('handle:end'))
					})
				})
				.get(
					'/',
					{
						beforeHandle: [
							() => {
								order.push('first')
								return 'early'
							},
							() => order.push('second')
						]
					} as any,
					() => {
						order.push('handler')
						return 'late'
					}
				)

			const response = await app.handle(request())
			return { order, trace, body: await response.text() }
		}

		const expected = await observe({})
		const actual = await observe({ resumeEmit })
		expect(actual).toEqual(expected)
		expect(actual).toEqual({
			order: ['first'],
			trace: [
				'beforeHandle:begin',
				'beforeHandle:anonymous:begin',
				'beforeHandle:anonymous:end',
				'beforeHandle:end',
				'handle:begin',
				'handle:anonymous:begin',
				'handle:anonymous:end',
				'handle:end'
			],
			body: 'early'
		})
	})

	it('reports awaited beforeHandle error returns like JIT', async () => {
		const observe = async (experimental: any) => {
			const errors: Array<string | undefined> = []
			let handlerCalls = 0
			const app = new Elysia({ experimental })
				.trace(({ onBeforeHandle }) => {
					onBeforeHandle(({ onEvent, onStop }) => {
						onEvent(({ onStop }) =>
							onStop(({ error }) => errors.push(error?.message))
						)
						onStop(({ error }) => errors.push(error?.message))
					})
				})
				.get(
					'/',
					{
						beforeHandle: async () => {
							await Promise.resolve()
							return new Error('blocked')
						}
					},
					() => {
						handlerCalls++
						return 'late'
					}
				)

			const response = await app.handle(request())
			await response.text()
			return { errors, handlerCalls, status: response.status }
		}

		const expected = await observe({})
		const actual = await observe({ resumeEmit })
		expect(actual).toEqual(expected)
		expect(actual).toEqual({
			errors: ['blocked', 'blocked'],
			handlerCalls: 0,
			status: 500
		})
	})

	it('exposes successful derive values before child stop like JIT', async () => {
		const observe = async (
			experimental: any,
			awaited: boolean,
			compatAsync = false
		) => {
			const values: unknown[] = []
			const derive = awaited
				? async () => {
						await Promise.resolve()
						return { user: 'alice' }
					}
				: () => ({ user: 'alice' })
			const app = new Elysia({
				experimental: compatAsync
					? { ...experimental, cancellation: 'compat' }
					: experimental
			})
				.trace(({ context, onBeforeHandle }) => {
					onBeforeHandle(({ onEvent }) => {
						onEvent(({ onStop }) =>
							onStop(() => values.push((context as any).user))
						)
					})
				})
				.macro({ withUser: { derive } } as any)
				.get(
					'/',
					{ withUser: true } as any,
					compatAsync
						? async ({ user }: any) => user
						: ({ user }: any) => user
				)

			const response = await app.handle(request())
			return { body: await response.text(), values }
		}

		for (const awaited of [false, true]) {
			const expected = await observe({}, awaited)
			const actual = await observe({ resumeEmit }, awaited)
			expect(actual).toEqual(expected)
			expect(actual).toEqual({
				body: 'alice',
				values: [awaited ? undefined : 'alice']
			})
		}

		const expected = await observe({}, true, true)
		const actual = await observe({ resumeEmit }, true, true)
		expect(actual).toEqual(expected)
		expect(actual).toEqual({ body: 'alice', values: ['alice'] })
	})

	it('reports successful handle completion with null errors like JIT', async () => {
		const observe = async (experimental: any) => {
			const errors: unknown[] = []
			const app = new Elysia({ experimental })
				.trace(({ onHandle }) => {
					onHandle(({ onEvent, onStop }) => {
						onEvent(({ onStop }) =>
							onStop(({ error }) => errors.push(error))
						)
						onStop(({ error }) => errors.push(error))
					})
				})
				.get('/', async function route() {
					await Promise.resolve()
					return 'ok'
				})

			expect(await (await app.handle(request())).text()).toBe('ok')
			return errors
		}

		const expected = await observe({})
		const actual = await observe({ resumeEmit })
		expect(actual).toEqual(expected)
		expect(actual).toEqual([null, null])
	})

	it('initializes trace-only response phases like JIT', async () => {
		const observe = async (experimental: any) => {
			const responses: unknown[] = []
			const app = new Elysia({ experimental })
				.trace(({ onAfterHandle, onMapResponse, context }) => {
					onAfterHandle(() =>
						responses.push((context as any).responseValue)
					)
					onMapResponse(() =>
						responses.push((context as any).responseValue)
					)
				})
				.get('/', async () => 'ok')

			expect(await (await app.handle(request())).text()).toBe('ok')
			return responses
		}

		const expected = await observe({})
		const actual = await observe({ resumeEmit })
		expect(actual).toEqual(expected)
		expect(actual).toEqual(['ok', 'ok'])
	})

	it('preserves rejected handler errors during abort cleanup like JIT', async () => {
		const observe = async (experimental: any) => {
			const controller = new AbortController()
			const errors: unknown[] = []
			const app = new Elysia({ experimental })
				.trace(({ onHandle }) => {
					onHandle(({ onEvent, onStop }) => {
						onEvent(({ onStop }) =>
							onStop(({ error }) => errors.push(error?.message))
						)
						onStop(({ error }) => errors.push(error?.message))
					})
				})
				.get('/', async () => {
					controller.abort()
					await Promise.resolve()
					throw new Error('rejected')
				})

			const response = await app.handle(
				new Request('http://localhost/', { signal: controller.signal })
			)
			expect(await response.text()).toBe('')
			return errors
		}

		const expected = await observe({})
		const actual = await observe({ resumeEmit })
		expect(actual).toEqual(expected)
		expect(actual).toEqual(['rejected', 'rejected'])
	})

	it('waits for generator completion before handle stop and afterResponse', async () => {
		const order: string[] = []
		let release!: () => void
		const gate = new Promise<void>((resolve) => (release = resolve))

		const app = new Elysia({ experimental: { resumeEmit } })
			.trace(({ onHandle, onAfterResponse }) => {
				onHandle(({ onStop }) => onStop(() => order.push('handle:end')))
				onAfterResponse(() => order.push('after:trace'))
			})
			.get(
				'/',
				{
					afterResponse: async () => {
						order.push('after:hook:start')
						await Promise.resolve()
						order.push('after:hook:end')
					}
				} as any,
				async function* stream() {
					order.push('stream:start')
					yield 'a'
					await gate
					order.push('stream:end')
					yield 'b'
				}
			)

		const response = await app.handle(request())
		await flush()
		expect(order).not.toContain('handle:end')
		expect(order).not.toContain('after:trace')
		expect(order).not.toContain('after:hook:start')

		release()
		expect(await response.text()).toBe('ab')
		await flush()

		expect(order.indexOf('stream:end')).toBeLessThan(
			order.indexOf('handle:end')
		)
		expect(order.indexOf('handle:end')).toBeLessThan(
			order.indexOf('after:trace')
		)
		expect(order).toContain('after:hook:end')
	})

	it('continues after a thrown afterResponse hook', async () => {
		const order: string[] = []
		const app = new Elysia({ experimental: { resumeEmit } }).get(
			'/',
			{
				afterResponse: [
					() => {
						order.push('throw')
						throw new Error('ignored')
					},
					async () => {
						await Promise.resolve()
						order.push('next')
					}
				]
			} as any,
			() => 'ok'
		)

		await app.handle(request())
		await flush()
		expect(order).toEqual(['throw', 'next'])
	})

	it('keeps unknown trace listeners fail-open on the resume lane', async () => {
		let transform = 0
		const listener = function () {
			const lifecycle = arguments[0] as any
			lifecycle.onTransform(() => transform++)
		}
		const app = new Elysia({
			introspect: true,
			experimental: { resumeEmit }
		})
			.trace(listener as any)
			.get('/', { transform: () => {} } as any, () => 'ok')

		await app.handle(request())
		expect(transform).toBe(1)
		const plan = routePlans.get(app as any)!.get('GET /')!
		expect(plan.supported).toBe(true)
		expect(plan.unsupportedReasons).not.toContain('trace')
	})

	it('keeps handler custom-thenable behavior equal to the legacy lane', async () => {
		const value = {
			then(resolve: (value: string) => void) {
				resolve('assimilated')
			}
		}
		const build = (app: Elysia<any>) => app.get('/', () => value as any)
		const legacy = build(new Elysia())
		const resume = build(new Elysia({ experimental: { resumeEmit } }))

		const [expected, actual] = await Promise.all([
			legacy.handle(request()),
			resume.handle(request())
		])
		expect(actual.status).toBe(expected.status)
		expect(await actual.text()).toBe(await expected.text())
	})
})
