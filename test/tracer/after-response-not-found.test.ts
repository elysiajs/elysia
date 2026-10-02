import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'
import { trace } from '../../src/plugin/trace'

// The router-miss lane traced afterResponse after the hooks had already run,
// reporting ~0 ms where the compiled lane reports the hooks' real duration
describe('afterResponse trace on a router miss', () => {
	const elapsedFor = async (path: string) => {
		const { promise, resolve } = Promise.withResolvers<number>()
		const app = new Elysia()
			.use(trace())
			.trace(({ onAfterResponse }) => {
				onAfterResponse(({ onStop }) => {
					onStop(({ elapsed }) => resolve(elapsed))
				})
			})
			.afterResponse(async () => {
				await Bun.sleep(20)
			})
			.get('/', () => 'hit')

		await app.handle(new Request(`http://localhost${path}`))

		return promise
	}

	it('covers the hooks on a hit and on a miss alike', async () => {
		// a sleep never ends early, so the lower bound is stable
		expect(await elapsedFor('/')).toBeGreaterThanOrEqual(15)
		expect(await elapsedFor('/missing')).toBeGreaterThanOrEqual(15)
	})
})
