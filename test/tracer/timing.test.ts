/* eslint-disable @typescript-eslint/no-unused-vars */
import { Elysia } from '../../src'
import { describe, expect, it } from 'bun:test'
import { post, req } from '../utils'

const delay = (delay = 7) =>
	new Promise((resolve) => setTimeout(resolve, delay))

describe('Trace Timing', async () => {
	it('handle', async () => {
		const app = new Elysia()
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

		const { headers } = await app.handle(req('/'))

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('request', async () => {
		const app = new Elysia()
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

		const { headers } = await app.handle(req('/'))

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('parse', async () => {
		const app = new Elysia()
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

		const { headers } = await app.handle(post('/', {}))

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('transform', async () => {
		const app = new Elysia()
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

		const { headers } = await app.handle(req('/'))

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('beforeHandle', async () => {
		const app = new Elysia()
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

		const { headers } = await app.handle(req('/'))

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('afterHandle', async () => {
		const app = new Elysia()
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

		const { headers } = await app.handle(req('/'))

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('mapResponse', async () => {
		const app = new Elysia()
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

		const { headers } = await app.handle(req('/'))

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('afterResponse', async () => {
		const app = new Elysia()
			.trace(({ onAfterResponse, set }) => {
				onAfterResponse(({ onStop }) => {
					onStop(({ elapsed }) => {
						expect(elapsed).toBeGreaterThan(5)
					})
				})
			})
			.afterResponse(async () => {
				await delay()
			})
			.get('/', () => 'a')

		app.handle(req('/'))
	})

	it('inline parse', async () => {
		const app = new Elysia()
			.trace(({ onParse, set }) => {
				onParse(({ onStop }) => {
					onStop(({ elapsed }) => {
						set.headers.time = elapsed.toString()
					})
				})
			})
			.post('/', ({ body }) => 'a', {
				async parse() {
					await delay()
				}
			})

		const { headers } = await app.handle(post('/', {}))

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('inline transform', async () => {
		const app = new Elysia()
			.trace(({ onTransform, set }) => {
				onTransform(({ onStop }) => {
					onStop(({ elapsed }) => {
						set.headers.time = elapsed.toString()
					})
				})
			})
			.get('/', () => 'a', {
				async transform() {
					await delay()
				}
			})

		const { headers } = await app.handle(req('/'))

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('inline beforeHandle', async () => {
		const app = new Elysia()
			.trace(({ onBeforeHandle, set }) => {
				onBeforeHandle(({ onStop }) => {
					onStop(({ elapsed }) => {
						set.headers.time = elapsed.toString()
					})
				})
			})
			.get('/', () => 'a', {
				async beforeHandle() {
					await delay()
				}
			})

		const { headers } = await app.handle(req('/'))

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('inline afterHandle', async () => {
		const app = new Elysia()
			.trace(({ onAfterHandle, set }) => {
				onAfterHandle(({ onStop }) => {
					onStop(({ elapsed }) => {
						set.headers.time = elapsed.toString()
					})
				})
			})
			.get('/', () => 'a', {
				async afterHandle() {
					await delay()
				}
			})

		const { headers } = await app.handle(req('/'))

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('inline mapResponse', async () => {
		const app = new Elysia()
			.trace(({ onMapResponse, set }) => {
				onMapResponse(({ onStop }) => {
					onStop(({ elapsed }) => {
						set.headers.time = elapsed.toString()
					})
				})
			})
			.get('/', () => 'a', {
				async mapResponse() {
					await delay()
				}
			})

		const { headers } = await app.handle(req('/'))

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('inline afterResponse', async () => {
		const app = new Elysia()
			.trace(({ onAfterResponse, set }) => {
				onAfterResponse(({ onStop }) => {
					onStop(({ elapsed }) => {
						expect(elapsed).toBeGreaterThan(5)
					})
				})
			})
			.get('/', () => 'a', {
				async afterResponse() {
					await delay()
				}
			})

		app.handle(req('/'))
	})

	it('parse unit', async () => {
		const app = new Elysia()
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
				await delay(6)
			})
			.post('/', ({ body }) => body, {
				parse: [
					async function kindred() {
						await delay(6)
					}
				]
			})

		const { headers } = await app.handle(post('/', {}))

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('transform unit', async () => {
		const app = new Elysia()
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
				await delay(6)
			})
			.get('/', () => 'a', {
				transform: [
					async function kindred() {
						await delay(6)
					}
				]
			})

		const { headers } = await app.handle(req('/'))

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('beforeHandle unit', async () => {
		const app = new Elysia()
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
				await delay(6)
			})
			.get('/', () => 'a', {
				beforeHandle: [
					async function kindred() {
						await delay(6)
					}
				]
			})

		const { headers } = await app.handle(req('/'))

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('beforeHandle units', async () => {
		const app = new Elysia()
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
				await delay(6.25)
			})
			.get('/', () => 'a', {
				beforeHandle: [
					async function kindred() {
						await delay(6.25)
					}
				]
			})

		const { headers } = await app.handle(req('/'))

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('afterHandle unit', async () => {
		const app = new Elysia()
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
				await delay(6)
			})
			.get('/', () => 'a', {
				afterHandle: [
					async function kindred() {
						await delay(6)
					}
				]
			})

		const { headers } = await app.handle(req('/'))

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('mapResponse unit', async () => {
		const app = new Elysia()
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
				await delay(6)
			})
			.get('/', () => 'a', {
				mapResponse: [
					async function kindred() {
						await delay(6)
					}
				]
			})

		const { headers } = await app.handle(req('/'))

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('afterResponse unit', async () => {
		const app = new Elysia()
			.trace(({ onAfterResponse, set }) => {
				onAfterResponse(({ onStop, onEvent }) => {
					let total = 0

					onEvent(({ onStop }) => {
						onStop(({ elapsed }) => {
							total += elapsed
						})
					})

					onStop(() => {
						set.headers.time = total.toString()
					})
				})
			})
			.afterResponse(async function luna() {
				await delay(6)
			})
			.get('/', () => 'a', {
				afterResponse: [
					async function kindred() {
						await delay(6)
					}
				]
			})

		app.handle(req('/'))
	})
})
