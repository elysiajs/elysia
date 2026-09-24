/* eslint-disable @typescript-eslint/no-unused-vars */
import { Elysia } from '../../src'
import { trace } from '../../src/plugin/trace'
import { describe, expect, it } from 'bun:test'
import { post, json } from '../utils'

const delay = (delay = 20) =>
	new Promise((resolve) => setTimeout(resolve, delay))

describe('Trace Timing', async () => {
	it('handle', async () => {
		const app = new Elysia()
			.use(trace())
			.trace(({ onHandle, set }) => {
				onHandle(({ onStop }) => {
					onStop(({ elapsed }) => {
						set.headers.time = elapsed.toString()
					})
				})
			})
			.get('/', async () => {
				await delay()

				return 'a'
			})

		const { headers } = await app.handle('/')

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('request', async () => {
		const app = new Elysia()
			.use(trace())
			.trace(({ onRequest, set }) => {
				onRequest(({ onStop }) => {
					onStop(({ elapsed }) => {
						set.headers.time = elapsed.toString()
					})
				})
			})
			.request(async () => {
				await delay()
			})
			.get('/', () => 'a')

		const { headers } = await app.handle('/')

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('parse', async () => {
		const app = new Elysia()
			.use(trace())
			.trace(({ onParse, set }) => {
				onParse(({ onStop }) => {
					onStop(({ elapsed }) => {
						set.headers.time = elapsed.toString()
					})
				})
			})
			.parse(async () => {
				await delay()
			})
			.post('/', ({ body }) => 'a')

		const { headers } = await app.handle('/', json({}))

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('transform', async () => {
		const app = new Elysia()
			.use(trace())
			.trace(({ onTransform, set }) => {
				onTransform(({ onStop }) => {
					onStop(({ elapsed }) => {
						set.headers.time = elapsed.toString()
					})
				})
			})
			.transform(async () => {
				await delay()
			})
			.get('/', () => 'a')

		const { headers } = await app.handle('/')

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('beforeHandle', async () => {
		const app = new Elysia()
			.use(trace())
			.trace(({ onBeforeHandle, set }) => {
				onBeforeHandle(({ onStop }) => {
					onStop(({ elapsed }) => {
						set.headers.time = elapsed.toString()
					})
				})
			})
			.beforeHandle(async () => {
				await delay()
			})
			.get('/', () => 'a')

		const { headers } = await app.handle('/')

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('afterHandle', async () => {
		const app = new Elysia()
			.use(trace())
			.trace(({ onAfterHandle, set }) => {
				onAfterHandle(({ onStop }) => {
					onStop(({ elapsed }) => {
						set.headers.time = elapsed.toString()
					})
				})
			})
			.afterHandle(async () => {
				await delay()
			})
			.get('/', () => 'a')

		const { headers } = await app.handle('/')

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('mapResponse', async () => {
		const app = new Elysia()
			.use(trace())
			.trace(({ onMapResponse, set }) => {
				onMapResponse(({ onStop }) => {
					onStop(({ elapsed }) => {
						set.headers.time = elapsed.toString()
					})
				})
			})
			.mapResponse(async () => {
				await delay()
			})
			.get('/', () => 'a')

		const { headers } = await app.handle('/')

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('afterResponse', async () => {
		const { promise, resolve } = Promise.withResolvers<number>()

		const app = new Elysia()
			.use(trace())
			.trace(({ onAfterResponse }) => {
				onAfterResponse(({ onStop }) => {
					onStop(({ elapsed }) => {
						resolve(elapsed)
					})
				})
			})
			.afterResponse(async () => {
				await delay()
			})
			.get('/', () => 'a')

		await app.handle('/')

		await expect(promise).resolves.toBeGreaterThan(5)
	})

	it('inline parse', async () => {
		const app = new Elysia()
			.use(trace())
			.trace(({ onParse, set }) => {
				onParse(({ onStop }) => {
					onStop(({ elapsed }) => {
						set.headers.time = elapsed.toString()
					})
				})
			})
			.post(
				'/',
				{
					async parse() {
						await delay()
					}
				},
				({ body }) => 'a'
			)

		const { headers } = await app.handle('/', json({}))

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('inline transform', async () => {
		const app = new Elysia()
			.use(trace())
			.trace(({ onTransform, set }) => {
				onTransform(({ onStop }) => {
					onStop(({ elapsed }) => {
						set.headers.time = elapsed.toString()
					})
				})
			})
			.get(
				'/',
				{
					async transform() {
						await delay()
					}
				},
				() => 'a'
			)

		const { headers } = await app.handle('/')

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('inline beforeHandle', async () => {
		const app = new Elysia()
			.use(trace())
			.trace(({ onBeforeHandle, set }) => {
				onBeforeHandle(({ onStop }) => {
					onStop(({ elapsed }) => {
						set.headers.time = elapsed.toString()
					})
				})
			})
			.get(
				'/',
				{
					async beforeHandle() {
						await delay()
					}
				},
				() => 'a'
			)

		const { headers } = await app.handle('/')

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('inline afterHandle', async () => {
		const app = new Elysia()
			.use(trace())
			.trace(({ onAfterHandle, set }) => {
				onAfterHandle(({ onStop }) => {
					onStop(({ elapsed }) => {
						set.headers.time = elapsed.toString()
					})
				})
			})
			.get(
				'/',
				{
					async afterHandle() {
						await delay()
					}
				},
				() => 'a'
			)

		const { headers } = await app.handle('/')

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('inline mapResponse', async () => {
		const app = new Elysia()
			.use(trace())
			.trace(({ onMapResponse, set }) => {
				onMapResponse(({ onStop }) => {
					onStop(({ elapsed }) => {
						set.headers.time = elapsed.toString()
					})
				})
			})
			.get(
				'/',
				{
					async mapResponse() {
						await delay()
					}
				},
				() => 'a'
			)

		const { headers } = await app.handle('/')

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('inline afterResponse', async () => {
		const { promise, resolve } = Promise.withResolvers<number>()

		const app = new Elysia()
			.use(trace())
			.trace(({ onAfterResponse }) => {
				onAfterResponse(({ onStop }) => {
					onStop(({ elapsed }) => {
						resolve(elapsed)
					})
				})
			})
			.get(
				'/',
				{
					async afterResponse() {
						await delay()
					}
				},
				() => 'a'
			)

		await app.handle('/')

		await expect(promise).resolves.toBeGreaterThan(5)
	})

	it('parse unit', async () => {
		const app = new Elysia()
			.use(trace())
			.trace(({ onParse, set }) => {
				onParse(({ onStop, onEvent }) => {
					let total = 0

					onEvent(({ onStop }) => {
						onStop(({ elapsed }) => {
							total += elapsed
						})
					})

					onStop(({ elapsed }) => {
						set.headers.time = total.toString()
					})
				})
			})
			.parse(async function luna() {
				await delay(20)
			})
			.post(
				'/',
				{
					parse: [
						async function kindred() {
							await delay(20)
						}
					]
				},
				({ body }) => body
			)

		const { headers } = await app.handle('/', json({}))

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('transform unit', async () => {
		const app = new Elysia()
			.use(trace())
			.trace(({ onTransform, set }) => {
				onTransform(({ onStop, onEvent }) => {
					let total = 0

					onEvent(({ onStop }) => {
						onStop(({ elapsed }) => {
							total += elapsed
						})
					})

					onStop(({ elapsed }) => {
						set.headers.time = total.toString()
					})
				})
			})
			.transform(async function luna() {
				await delay(20)
			})
			.get(
				'/',
				{
					transform: [
						async function kindred() {
							await delay(20)
						}
					]
				},
				() => 'a'
			)

		const { headers } = await app.handle('/')

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('beforeHandle unit', async () => {
		const app = new Elysia()
			.use(trace())
			.trace(({ onBeforeHandle, set }) => {
				onBeforeHandle(({ onStop, onEvent }) => {
					let total = 0

					onEvent(({ onStop }) => {
						onStop(({ elapsed }) => {
							total += elapsed
						})
					})

					onStop(({ elapsed }) => {
						set.headers.time = total.toString()
					})
				})
			})
			.beforeHandle(async function luna() {
				await delay(20)
			})
			.get(
				'/',
				{
					beforeHandle: [
						async function kindred() {
							await delay(20)
						}
					]
				},
				() => 'a'
			)

		const { headers } = await app.handle('/')

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('beforeHandle units', async () => {
		const app = new Elysia()
			.use(trace())
			.trace(({ onBeforeHandle, set }) => {
				onBeforeHandle(({ onStop, onEvent }) => {
					let total = 0

					onEvent(({ onStop }) => {
						onStop(({ elapsed }) => {
							total += elapsed
						})
					})

					onStop(({ elapsed }) => {
						set.headers.time = total.toString()
					})
				})
			})
			.beforeHandle(async function luna() {
				await delay(20)
			})
			.get(
				'/',
				{
					beforeHandle: [
						async function kindred() {
							await delay(20)
						}
					]
				},
				() => 'a'
			)

		const { headers } = await app.handle('/')

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('afterHandle unit', async () => {
		const app = new Elysia()
			.use(trace())
			.trace(({ onAfterHandle, set }) => {
				onAfterHandle(({ onStop, onEvent }) => {
					let total = 0

					onEvent(({ onStop }) => {
						onStop(({ elapsed }) => {
							total += elapsed
						})
					})

					onStop(({ elapsed }) => {
						set.headers.time = total.toString()
					})
				})
			})
			.afterHandle(async function luna() {
				await delay(20)
			})
			.get(
				'/',
				{
					afterHandle: [
						async function kindred() {
							await delay(20)
						}
					]
				},
				() => 'a'
			)

		const { headers } = await app.handle('/')

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('mapResponse unit', async () => {
		const app = new Elysia()
			.use(trace())
			.trace(({ onMapResponse, set }) => {
				onMapResponse(({ onStop, onEvent }) => {
					let total = 0

					onEvent(({ onStop }) => {
						onStop(({ elapsed }) => {
							total += elapsed
						})
					})

					onStop(({ elapsed }) => {
						set.headers.time = total.toString()
					})
				})
			})
			.mapResponse(async function luna() {
				await delay(20)
			})
			.get(
				'/',
				{
					mapResponse: [
						async function kindred() {
							await delay(20)
						}
					]
				},
				() => 'a'
			)

		const { headers } = await app.handle('/')

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('afterResponse unit', async () => {
		const { promise, resolve } = Promise.withResolvers<number>()

		const app = new Elysia()
			.use(trace())
			.trace(({ onAfterResponse }) => {
				onAfterResponse(({ onStop, onEvent }) => {
					let total = 0

					onEvent(({ onStop }) => {
						onStop(({ elapsed }) => {
							total += elapsed
						})
					})

					onStop(() => {
						resolve(total)
					})
				})
			})
			.afterResponse(async function luna() {
				await delay(20)
			})
			.get(
				'/',
				{
					afterResponse: [
						async function kindred() {
							await delay(20)
						}
					]
				},
				() => 'a'
			)

		await app.handle('/')

		await expect(promise).resolves.toBeGreaterThan(5)
	})
})
