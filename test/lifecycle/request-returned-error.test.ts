import { describe, expect, it } from 'bun:test'
import { Elysia, HTTPError, status } from '../../src'
import { trace } from '../../src/plugin/trace'

class TooManyRequests extends HTTPError.id('TOO_MANY_REQUESTS', 429) {
	readonly detail = 'Slow down'
	readonly headers = { 'retry-after': '5' }
}

const lanes = {
	direct: (error: Error) => () => error,
	async: (error: Error) => async () => error,
	promise: (error: Error) => () => Promise.resolve(error),
	thrown: (error: Error) => () => {
		throw error
	}
}

describe('onRequest returning an Error', () => {
	for (const traced of [false, true]) {
		for (const [lane, hook] of Object.entries(lanes))
			it(`uses the thrown-error pipeline (${lane}, trace: ${traced})`, async () => {
				const error = new TooManyRequests()
				const app = new Elysia()
				let childError: unknown
				let phaseError: unknown
				let childStops = 0
				let phaseStops = 0
				let continued = false
				if (traced)
					app.use(trace()).trace(({ onRequest }) => {
						onRequest(({ onEvent, onStop }) => {
							onEvent(({ onStop }) => {
								onStop(({ error }) => {
									childError = error
									childStops++
								})
							})
							onStop(({ error }) => {
								phaseError = error
								phaseStops++
							})
						})
					})
				app.onRequest(hook(error))
					.onRequest(() => {
						continued = true
					})
					.get('/', () => {
						continued = true
						return 'unreachable'
					})

				const response = await app.handle('/')
				expect(response.status).toBe(429)
				expect(response.headers.get('retry-after')).toBe('5')
				await expect(response.json()).resolves.toMatchObject({
					type: 'TOO_MANY_REQUESTS',
					status: 429,
					detail: 'Slow down'
				})
				expect(continued).toBe(false)
				if (traced) {
					expect(childError).toBe(error)
					expect(phaseError).toBe(error)
					expect(childStops).toBe(1)
					expect(phaseStops).toBe(1)
				}
			})

		it(`dispatches error hooks and finalizes afterResponse (trace: ${traced})`, async () => {
			const error = new TooManyRequests()
			const app = new Elysia()
			const completed = Promise.withResolvers<number>()
			let caught: unknown
			if (traced)
				app.use(trace()).trace(({ onRequest }) => onRequest(() => {}))
			app.onError(TooManyRequests, async (context) => {
				caught = context.error
				await Promise.resolve()
				return status(418, 'limited')
			})
				.onRequest(() => Promise.resolve(error))
				.onAfterResponse(({ set }) => {
					completed.resolve(set.status as number)
				})
				.get('/', () => 'unreachable')

			const response = await app.handle('/')
			expect(response.status).toBe(418)
			await expect(response.text()).resolves.toBe('limited')
			expect(caught).toBe(error)
			await expect(completed.promise).resolves.toBe(418)
		})

		it(`preserves abort before an early Error response (trace: ${traced})`, async () => {
			const controller = new AbortController()
			const app = new Elysia()
			if (traced)
				app.use(trace()).trace(({ onRequest }) => onRequest(() => {}))
			app.onRequest(() => {
				controller.abort()
				return new TooManyRequests()
			}).get('/', () => 'unreachable')
			const response = await app.handle('/', {
				signal: controller.signal
			})
			expect(response.status).toBe(200)
			await expect(response.text()).resolves.toBe('')
		})

		it(`preserves ordinary early responses (trace: ${traced})`, async () => {
			const app = new Elysia()
			if (traced)
				app.use(trace()).trace(({ onRequest }) => onRequest(() => {}))
			app.onRequest(() => 'ready').get('/', () => 'unreachable')
			const response = await app.handle('/')
			expect(response.status).toBe(200)
			await expect(response.text()).resolves.toBe('ready')
		})
	}
})
