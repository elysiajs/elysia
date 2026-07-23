import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'

const emitters = [['balanced', {}]] as const

const policies = ['suspension'] as const

const appFor = (
	emitter: (typeof emitters)[number][1],
	cancellation: 'suspension' | 'compat'
) => new Elysia({ experimental: { ...emitter, cancellation } })

const request = (controller: AbortController, init?: RequestInit) =>
	new Request('http://localhost/', {
		...init,
		signal: controller.signal
	})

describe('Q12 cancellation policy', () => {
	for (const [emitterName, emitter] of emitters)
		for (const cancellation of policies) {
			it(`${emitterName}/${cancellation}: pre-abort does not create a suspension boundary`, async () => {
				const controller = new AbortController()
				controller.abort()
				const order: string[] = []
				const app = appFor(emitter, cancellation).get(
					'/',
					{
						beforeHandle: () => {
							order.push('hook')
						}
					} as any,
					() => {
						order.push('handler')
						return 'ok'
					}
				)

				const response = await app.handle(request(controller))

				expect(order).toEqual(['hook', 'handler'])
				await expect(response.text()).resolves.toBe('ok')
			})

			it(`${emitterName}/${cancellation}: sync abort completes only in suspension mode`, async () => {
				const controller = new AbortController()
				const order: string[] = []
				const app = appFor(emitter, cancellation)
					.afterResponse(() => {
						order.push('afterResponse')
					})
					.get(
						'/',
						{
							beforeHandle: [
								() => {
									order.push('abort')
									controller.abort()
								},
								() => {
									order.push('later')
								}
							]
						} as any,
						() => {
							order.push('handler')
							return 'ok'
						}
					)

				const response = await app.handle(request(controller))
				await Bun.sleep(0)

				expect(order).toEqual([
					'abort',
					'later',
					'handler',
					'afterResponse'
				])
				await expect(response.text()).resolves.toBe('ok')
			})

			it(`${emitterName}/${cancellation}: abort after await stops the continuation`, async () => {
				const controller = new AbortController()
				const order: string[] = []
				const app = appFor(emitter, cancellation).get(
					'/',
					{
						beforeHandle: [
							async () => {
								order.push('start')
								controller.abort()
								await Promise.resolve()
								order.push('settled')
							},
							() => {
								order.push('later')
							}
						]
					} as any,
					() => {
						order.push('handler')
						return 'never'
					}
				)

				const response = await app.handle(request(controller))

				expect(order).toEqual(['start', 'settled'])
				await expect(response.text()).resolves.toBe('')
			})

			it(`${emitterName}/${cancellation}: missing-route error hooks use the selected policy`, async () => {
				const controller = new AbortController()
				const order: string[] = []
				const app = appFor(emitter, cancellation)
					.error(async () => {
						order.push('start')
						controller.abort()
						await Promise.resolve()
						order.push('end')
						return 'handled'
					})
					.get('/', () => 'ok')

				const response = await app.handle(
					new Request('http://localhost/missing', {
						signal: controller.signal
					})
				)

				expect(order).toEqual(['start', 'end'])
				await expect(response.text()).resolves.toBe('')
			})
		}

	for (const [emitterName, emitter] of emitters) {
		it(`${emitterName}: a synchronous parser does not create a cancellation boundary`, async () => {
			const controller = new AbortController()
			const order: string[] = []
			const app = appFor(emitter, 'suspension').post(
				'/',
				{
					parse: () => {
						order.push('parse')
						controller.abort()
						return { ok: true }
					},
					beforeHandle: () => {
						order.push('beforeHandle')
					}
				} as any,
				({ body }) => {
					order.push('handler')
					return body
				}
			)

			const response = await app.handle(
				request(controller, {
					method: 'POST',
					body: '{}',
					headers: { 'content-type': 'application/json' }
				})
			)

			expect(order).toEqual(['parse', 'beforeHandle', 'handler'])
			await expect(response.json()).resolves.toEqual({ ok: true })
		})

		it(`${emitterName}: plain async handler observes suspension cancellation`, async () => {
			const controller = new AbortController()
			const app = appFor(emitter, 'suspension').get('/', async () => {
				controller.abort()
				await Promise.resolve()
				return 'never'
			})

			const response = await app.handle(request(controller))
			await expect(response.text()).resolves.toBe('')
		})

		for (const [phase, listener] of [
			['transform', 'onTransform'],
			['beforeHandle', 'onBeforeHandle'],
			['afterHandle', 'onAfterHandle'],
			['mapResponse', 'onMapResponse']
		] as const)
			it(`${emitterName}: rejected ${phase} aborts retain trace errors`, async () => {
				const controller = new AbortController()
				const errors: string[] = []
				const hook = async () => {
					controller.abort()
					await Promise.resolve()
					throw new Error(`${phase} rejected`)
				}
				const app = appFor(emitter, 'suspension')
					.trace((lifecycle: any) => {
						lifecycle[listener](({ onEvent, onStop }: any) => {
							onEvent(({ onStop }: any) =>
								onStop(({ error }: any) =>
									errors.push(`child:${error?.message}`)
								)
							)
							onStop(({ error }: any) =>
								errors.push(`parent:${error?.message}`)
							)
						})
					})
					.get('/', { [phase]: hook } as any, () => 'ok')

				const response = await app.handle(request(controller))
				await expect(response.text()).resolves.toBe('')
				expect(errors).toEqual([
					`child:${phase} rejected`,
					`parent:${phase} rejected`
				])
			})

		for (const cancellation of policies)
			it(`${emitterName}/${cancellation}: body suspension observes cancellation`, async () => {
				const controller = new AbortController()
				let beforeHandle = false
				let handler = false
				const app = appFor(emitter, cancellation).post(
					'/',
					{
						parse: async () => {
							controller.abort()
							await Promise.resolve()
							return { ok: true }
						},
						beforeHandle: () => {
							beforeHandle = true
						}
					} as any,
					() => {
						handler = true
						return 'never'
					}
				)

				const response = await app.handle(
					request(controller, {
						method: 'POST',
						body: '{}',
						headers: { 'content-type': 'application/json' }
					})
				)

				expect(beforeHandle).toBe(false)
				expect(handler).toBe(false)
				await expect(response.text()).resolves.toBe('')
			})

		it(`${emitterName}: assimilates a handler thenable exactly once`, async () => {
			let thenCalled = 0
			const app = appFor(emitter, 'suspension').get(
				'/',
				() =>
					({
						then(resolve: (value: string) => void) {
							thenCalled++
							resolve('settled')
						}
					}) as any
			)

			const response = await app.handle(new Request('http://localhost/'))

			expect(thenCalled).toBe(1)
			await expect(response.text()).resolves.toBe('settled')
		})

		it(`${emitterName}: errors and afterResponse retain lifecycle parity`, async () => {
			let afterResponse = 0
			const app = appFor(emitter, 'suspension')
				.error(() => 'caught')
				.afterResponse(() => {
					afterResponse++
				})
				.get('/', async () => {
					await Promise.resolve()
					throw new Error('boom')
				})

			const response = await app.handle(new Request('http://localhost/'))
			await Bun.sleep(0)

			await expect(response.text()).resolves.toBe('caught')
			expect(afterResponse).toBe(1)
		})

		it(`${emitterName}: error-hook suspension observes cancellation`, async () => {
			const controller = new AbortController()
			const order: string[] = []
			const app = appFor(emitter, 'suspension').get(
				'/',
				{
					error: [
						async () => {
							order.push('first:start')
							controller.abort()
							await Promise.resolve()
							order.push('first:end')
						},
						() => {
							order.push('second')
							return 'handled'
						}
					]
				} as any,
				() => {
					throw new Error('boom')
				}
			)

			const response = await app.handle(request(controller))

			expect(order).toEqual(['first:start', 'first:end'])
			await expect(response.text()).resolves.toBe('')
		})

		it(`${emitterName}: error response mapping observes cancellation`, async () => {
			const controller = new AbortController()
			const app = appFor(emitter, 'suspension').get(
				'/',
				{
					error: () => () => {
						controller.abort()
						return Promise.resolve('mapped')
					}
				} as any,
				() => {
					throw new Error('boom')
				}
			)

			const response = await app.handle(request(controller))
			await expect(response.text()).resolves.toBe('')
		})

		it(`${emitterName}: async error toResponse observes cancellation`, async () => {
			const controller = new AbortController()
			const error = Object.assign(new Error('boom'), {
				async toResponse() {
					controller.abort()
					await Promise.resolve()
					return new Response('never')
				}
			})
			const app = appFor(emitter, 'suspension').get(
				'/',
				{ error: () => undefined } as any,
				() => {
					throw error
				}
			)

			const response = await app.handle(request(controller))
			await expect(response.text()).resolves.toBe('')
		})

		it(`${emitterName}: parse cancellation closes child trace before its parent`, async () => {
			const controller = new AbortController()
			const order: string[] = []
			const app = appFor(emitter, 'suspension')
				.trace(({ onParse }) => {
					onParse(({ onEvent, onStop }) => {
						onEvent(({ onStop }) =>
							onStop(() => order.push('child:end'))
						)
						onStop(() => order.push('parent:end'))
					})
				})
				.post(
					'/',
					{
						parse: async () => {
							controller.abort()
							await Promise.resolve()
							throw new Error('parse failed')
						}
					} as any,
					() => 'never'
				)

			const response = await app.handle(
				request(controller, {
					method: 'POST',
					body: 'x',
					headers: { 'content-type': 'x/test' }
				})
			)

			await expect(response.text()).resolves.toBe('')
			expect(order).toEqual(['child:end', 'parent:end'])
		})

		it(`${emitterName}: error trace reports hook children`, async () => {
			const order: string[] = []
			const app = appFor(emitter, 'suspension')
				.trace(({ onError }) => {
					onError(({ onEvent, onStop }) => {
						onEvent(({ name, onStop }) => {
							order.push(`${name}:start`)
							onStop(() => order.push(`${name}:end`))
						})
						onStop(() => order.push('parent:end'))
					})
				})
				.get(
					'/',
					{
						error: function recover() {
							return 'handled'
						}
					} as any,
					() => {
						throw new Error('boom')
					}
				)

			await expect(
				(await app.handle(new Request('http://localhost/'))).text()
			).resolves.toBe('handled')
			expect(order).toEqual([
				'recover:start',
				'recover:end',
				'parent:end'
			])
		})

		it(`${emitterName}: error trace closes a rejected hook child`, async () => {
			const order: string[] = []
			const app = appFor(emitter, 'suspension')
				.trace(({ onError }) => {
					onError(({ onEvent, onStop }) => {
						onEvent(({ onStop }) =>
							onStop(({ error }) =>
								order.push(`child:${error?.message}`)
							)
						)
						onStop(({ error }) =>
							order.push(`parent:${error?.message}`)
						)
					})
				})
				.get(
					'/',
					{
						error: async () => {
							await Promise.resolve()
							throw new Error('hook failed')
						}
					} as any,
					() => {
						throw new Error('route failed')
					}
				)

			await app.handle(new Request('http://localhost/'))
			expect(order).toEqual(['child:hook failed', 'parent:hook failed'])
		})

		it(`${emitterName}: maybe-async afterResponse hooks remain sequential`, async () => {
			const order: string[] = []
			const app = appFor(emitter, 'suspension').get(
				'/',
				{
					afterResponse: [
						() => {
							order.push('first:start')
							return Promise.resolve().then(() => {
								order.push('first:end')
								throw new Error('ignored')
							})
						},
						() => order.push('second')
					]
				} as any,
				() => 'ok'
			)

			await app.handle(new Request('http://localhost/'))
			await Bun.sleep(0)
			expect(order).toEqual(['first:start', 'first:end', 'second'])
		})

		it(`${emitterName}: trace can mutate materialized default headers`, async () => {
			const app = appFor(emitter, 'suspension')
				.headers({ 'x-default': 'default' })
				.trace(({ onHandle, set }) => {
					set.headers['x-tracer'] = 'tracer'
					onHandle(() => {
						set.headers['x-handle'] = 'handle'
					})
				})
				.get('/', () => 'ok')

			const response = await app.handle(new Request('http://localhost/'))
			expect(response.headers.get('x-default')).toBe('default')
			expect(response.headers.get('x-tracer')).toBe('tracer')
			expect(response.headers.get('x-handle')).toBe('handle')
		})

		for (const rejects of [false, true])
			it(`${emitterName}: terminal mapper ${rejects ? 'rejection' : 'resolution'} observes cancellation`, async () => {
				const controller = new AbortController()
				let afterResponse = 0
				const app = appFor(emitter, 'suspension')
					.afterResponse(() => {
						afterResponse++
					})
					.get('/', () => () => {
						controller.abort()
						return rejects
							? Promise.reject(new Error('mapped'))
							: Promise.resolve('mapped')
					})

				const response = await app.handle(request(controller))
				await Bun.sleep(0)

				await expect(response.text()).resolves.toBe('')
				expect(afterResponse).toBe(1)
			})

	}

	it('rejects the removed compat policy at seal', () => {
		const app = appFor({}, 'compat').get('/', () => 'ok')
		expect(() => void app.fetch).toThrow('compat-cancellation')
	})

	it('root early-response mapping observes fulfilled and rejected cancellation', async () => {
		for (const rejects of [false, true]) {
			const controller = new AbortController()
			const app = new Elysia()
				.request(() => () => {
					controller.abort()
					return rejects
						? Promise.reject(new Error('mapped'))
						: Promise.resolve('mapped')
				})
				.get('/', () => 'never')

			const response = await app.handle(request(controller))
			await expect(response.text()).resolves.toBe('')
		}
	})
})

describe('Q12 cancellation over listen', () => {
	for (const [emitterName, emitter] of emitters)
		for (const cancellation of policies)
			it(`${emitterName}/${cancellation}: client abort is observed after an awaited hook`, async () => {
				const started = Promise.withResolvers<void>()
				const release = Promise.withResolvers<void>()
				let later = false
				let handler = false
				const app = appFor(emitter, cancellation)
					.beforeHandle(async () => {
						started.resolve()
						await release.promise
					})
					.beforeHandle(() => {
						later = true
					})
					.get('/', () => {
						handler = true
						return 'never'
					})
					.listen(0)

				try {
					const controller = new AbortController()
					const pending = fetch(
						`http://localhost:${app.server!.port}/`,
						{ signal: controller.signal }
					).catch(() => undefined)

					await started.promise
					controller.abort()
					await Bun.sleep(10)
					release.resolve()
					await pending
					await Bun.sleep(10)

					expect(later).toBe(false)
					expect(handler).toBe(false)
				} finally {
					await app.stop(true)
				}
			})
})
