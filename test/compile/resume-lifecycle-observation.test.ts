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

	it('invokes toResponse once and maps its response once', async () => {
		let toResponse = 0
		let mapResponse = 0
		const error = Object.assign(new Error('teapot'), {
			status: 418,
			toResponse() {
				toResponse++
				return new Response('tea', { status: 418 })
			}
		})

		const app = new Elysia({ experimental: { resumeEmit } }).get(
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
		expect(response.status).toBe(418)
		expect(await response.text()).toBe('tea')
		expect(toResponse).toBe(1)
		expect(mapResponse).toBe(1)
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

	it('keeps unknown trace listeners fail-open on the mature lane', async () => {
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
		expect(
			routePlans.get(app as any)!.get('GET /')!.unsupportedReasons
		).toContain('trace')
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
