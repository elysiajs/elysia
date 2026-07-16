import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'
import { createAdapter } from '../../src/adapter'
import { WebStandardAdapter } from '../../src/adapter/web-standard'

const routeValue = Symbol('route value')

const rejectionCases = [
	{
		name: 'Promise',
		create(error: Error) {
			return Promise.reject(error)
		}
	},
	{
		name: 'custom thenable',
		create(error: Error) {
			return {
				then(
					_resolve: (value: never) => unknown,
					reject: (error: Error) => unknown
				) {
					reject(error)
				}
			}
		}
	}
] as const

for (const rejection of rejectionCases)
	describe(`async response map rejection (${rejection.name})`, () => {
		const setup = () => {
			const mapError = new Error(`map failed: ${rejection.name}`)
			const seen: unknown[] = []
			const adapter = createAdapter({
				...WebStandardAdapter,
				response: {
					...WebStandardAdapter.response,
					map(value, set, request) {
						if (value === routeValue)
							return rejection.create(mapError)

						return WebStandardAdapter.response.map(
							value,
							set,
							request
						)
					},
					compact(value, request) {
						if (value === routeValue)
							return rejection.create(mapError)

						return WebStandardAdapter.response.compact!(
							value,
							request
						)
					}
				}
			})
			const onError = ({ error }: { error: unknown }) => {
				seen.push(error)

				return new Response('mapped error', { status: 555 })
			}

			return { adapter, mapError, onError, seen }
		}

		const expectHandled = async (
			app: Elysia,
			mapError: Error,
			seen: unknown[]
		) => {
			const response = await app.handle(new Request('http://localhost/'))

			expect(seen).toEqual([mapError])
			expect(response.status).toBe(555)
			await expect(response.text()).resolves.toBe('mapped error')
		}

		it('handles a response-map rejection on a route without hooks', async () => {
			const { adapter, mapError, onError, seen } = setup()
			const app = new Elysia({ adapter })
				.get('/', () => routeValue)
				.error(onError)

			await expectHandled(app, mapError, seen)
		})

		it('handles a response-map rejection on a route with beforeHandle', async () => {
			const { adapter, mapError, onError, seen } = setup()
			const app = new Elysia({ adapter })
				.get('/', { beforeHandle() {} }, () => routeValue)
				.error(onError)

			await expectHandled(app, mapError, seen)
		})

		it('handles a response-map rejection when the handler reads context', async () => {
			const { adapter, mapError, onError, seen } = setup()
			const app = new Elysia({ adapter })
				.get('/', ({ headers }) => {
					void headers

					return routeValue
				})
				.error(onError)

			await expectHandled(app, mapError, seen)
		})

		it('handles a response-map rejection when the handler mutates set', async () => {
			const { adapter, mapError, onError, seen } = setup()
			const app = new Elysia({ adapter })
				.error(onError)
				.get('/', ({ set }) => {
					set.headers['x-test'] = 'set'

					return routeValue
				})

			await expectHandled(app, mapError, seen)
		})
	})
