/* eslint-disable @typescript-eslint/no-unused-vars */
import { Elysia } from '../../src'
import { describe, expect, it } from 'bun:test'
import { post, req } from '../utils'

const delay = (delay = 10) =>
	new Promise((resolve) => setTimeout(resolve, delay))

describe('Trace Timing', async () => {
	it('handle', async () => {
		const app = new Elysia()
			.trace(({ onHandle, set }) => {
				onHandle(({ begin, onStop }) => {
					onStop((end) => {
						set.headers.time = (end - begin).toString()
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
				onRequest(({ begin, onStop }) => {
					onStop((end) => {
						set.headers.time = (end - begin).toString()
					})
				})
			})
			.onRequest(async () => {
				await delay()
			})
			.get('/', () => 'a')

		const { headers } = await app.handle(req('/'))

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('parse', async () => {
		const app = new Elysia()
			.trace(({ onParse, set }) => {
				onParse(({ begin, onStop }) => {
					onStop((end) => {
						set.headers.time = (end - begin).toString()
					})
				})
			})
			.onParse(async () => {
				await delay()
			})
			.post('/', ({ body }) => 'a')

		const { headers } = await app.handle(post('/', {}))

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('transform', async () => {
		const app = new Elysia()
			.trace(({ onTransform, set }) => {
				onTransform(({ begin, onStop }) => {
					onStop((end) => {
						set.headers.time = (end - begin).toString()
					})
				})
			})
			.onTransform(async () => {
				await delay()
			})
			.get('/', () => 'a')

		const { headers } = await app.handle(req('/'))

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('beforeHandle', async () => {
		const app = new Elysia()
			.trace(({ onBeforeHandle, set }) => {
				onBeforeHandle(({ begin, onStop }) => {
					onStop((end) => {
						set.headers.time = (end - begin).toString()
					})
				})
			})
			.onBeforeHandle(async () => {
				await delay()
			})
			.get('/', () => 'a')

		const { headers } = await app.handle(req('/'))

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('afterHandle', async () => {
		const app = new Elysia()
			.trace(({ onAfterHandle, set }) => {
				onAfterHandle(({ begin, onStop }) => {
					onStop((end) => {
						set.headers.time = (end - begin).toString()
					})
				})
			})
			.onAfterHandle(async () => {
				await delay()
			})
			.get('/', () => 'a')

		const { headers } = await app.handle(req('/'))

		expect(+(headers.get('time') ?? 0)).toBeGreaterThan(5)
	})

	it('mapResponse', async () => {
		const app = new Elysia()
			.trace(({ onMapResponse, set }) => {
				onMapResponse(({ begin, onStop }) => {
					onStop((end) => {
						set.headers.time = (end - begin).toString()
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
				onAfterResponse(({ begin, onStop }) => {
					onStop((end) => {
						expect(end - begin).toBeGreaterThan(5)
					})
				})
			})
			.onAfterResponse(async () => {
				await delay()
			})
			.get('/', () => 'a')

		app.handle(req('/'))
	})

	it('inline parse', async () => {
		const app = new Elysia()
			.trace(({ onParse, set }) => {
				onParse(({ begin, onStop }) => {
					onStop((end) => {
						set.headers.time = (end - begin).toString()
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
				onTransform(({ begin, onStop }) => {
					onStop((end) => {
						set.headers.time = (end - begin).toString()
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
				onBeforeHandle(({ begin, onStop }) => {
					onStop((end) => {
						set.headers.time = (end - begin).toString()
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
				onAfterHandle(({ begin, onStop }) => {
					onStop((end) => {
						set.headers.time = (end - begin).toString()
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
				onMapResponse(({ begin, onStop }) => {
					onStop((end) => {
						set.headers.time = (end - begin).toString()
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
				onAfterResponse(({ begin, onStop }) => {
					onStop((end) => {
						expect(end - begin).toBeGreaterThan(5)
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

					onEvent(({ begin }) => {
						onStop((end) => {
							total += end - begin
						})
					})

					onStop((end) => {
						set.headers.time = total.toString()
					})
				})
			})
			.onParse(async function luna() {
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

					onEvent(({ begin, onStop }) => {
						onStop((end) => {
							total += end - begin
						})
					})

					onStop((end) => {
						set.headers.time = total.toString()
					})
				})
			})
			.onTransform(async function luna() {
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

					onEvent(({ begin, onStop }) => {
						onStop((end) => {
							total += end - begin
						})
					})

					onStop((end) => {
						set.headers.time = total.toString()
					})
				})
			})
			.onBeforeHandle(async function luna() {
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

					onEvent(({ begin, onStop }) => {
						onStop((end) => {
							total += end - begin
						})
					})

					onStop((end) => {
						set.headers.time = total.toString()
					})
				})
			})
			.onBeforeHandle(async function luna() {
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

					onEvent(({ begin, onStop }) => {
						onStop((end) => {
							total += end - begin
						})
					})

					onStop((end) => {
						set.headers.time = total.toString()
					})
				})
			})
			.onAfterHandle(async function luna() {
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

					onEvent(({ begin, onStop }) => {
						onStop((end) => {
							total += end - begin
						})
					})

					onStop((end) => {
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

					onEvent(({ begin, onStop }) => {
						onStop((end) => {
							total += end - begin
						})
					})

					onStop((end) => {
						set.headers.time = total.toString()
					})
				})
			})
			.onAfterResponse(async function luna() {
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
