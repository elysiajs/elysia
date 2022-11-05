import { KingWorld } from '../src'

import { describe, expect, it } from 'bun:test'

describe('Life Cycle', () => {
	it('handle onStart', async () => {
		let started = false

		const app = new KingWorld()
			.get('/', () => 'hi')
			.onStart(() => {
				started = true
			})
			.listen(3000)

		app.stop()

		expect(started).toBe(true)
	})

	it("handle .on('start')", async () => {
		let started = false

		const app = new KingWorld()
			.get('/', () => 'hi')
			.on('start', () => {
				started = true
			})
			.listen(3000)

		app.stop()

		expect(started).toBe(true)
	})

	it('handle onStop', async () => {
		let stopped = false

		const app = new KingWorld()
			.get('/', () => 'hi')
			.onStop(() => {
				stopped = true
			})
			.listen(3000)

		app.stop()

		expect(stopped).toBe(true)
	})

	it("handle .on('stop')", async () => {
		let started = false

		const app = new KingWorld()
			.get('/', () => 'hi')
			.on('stop', () => {
				started = true
			})
			.listen(3000)

		app.stop()

		expect(started).toBe(true)
	})

	// ? Blocking on https://github.com/oven-sh/bun/issues/1435
	// it('handle onError', async () => {
	// 	const app = new KingWorld()
	// 		.get('/', () => {
	// 			throw new Error('Something')
	// 		})
	// 		.onError((error) => {
	// 			if (error.message === 'Something') return new Response(':P')
	// 		})

	// 	const res = await app.handle(req('/'))

	// 	expect(await res.text()).toBe(':P')
	// })
})
