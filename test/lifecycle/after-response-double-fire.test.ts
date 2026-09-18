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
	})

describe('afterResponse count (dispatch lane)', () => {
	it('an app-level hook fires once for a pre-yield generator throw', async () => {
		const log: string[] = []
		const app = new Elysia()
			.afterResponse(() => {
				log.push('afterResponse')
			})
			.error(({ error }) => {
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
			.afterResponse(() => {
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
