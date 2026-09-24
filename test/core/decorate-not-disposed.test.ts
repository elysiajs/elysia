import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'

// The app does not own a value it was handed: `.decorate(pool)` is a borrow,
// often of a module singleton other apps (or tests) still use, so `stop()`
// never disposes it. The owner releases it explicitly with `.cleanup()`.
// Derive values are different - the derive minted them per request - and stay
// disposed (test/lifecycle/derive-dispose.test.ts)
const handed = (log: string[]) => ({
	query: () => 'rows',
	[Symbol.dispose]() {
		log.push('dispose')
	},
	async [Symbol.asyncDispose]() {
		log.push('asyncDispose')
	}
})

describe('decorate is not disposed on stop', () => {
	it('leaves it to .cleanup() on a listening app', async () => {
		const log: string[] = []
		const pool = handed(log)

		const app = new Elysia()
			.decorate('db', pool)
			.cleanup(() => {
				log.push('cleanup')
			})
			.get('/', ({ db }) => db.query())
			.listen(0)

		expect(await fetch(app.server!.url).then((r) => r.text())).toBe('rows')
		await app.stop()

		expect(log).toEqual(['cleanup'])
	})

	it('leaves it alone on the generic stop lane', async () => {
		const log: string[] = []

		const app = new Elysia()
			.decorate('db', handed(log))
			.cleanup(() => {
				log.push('cleanup')
			})
		// adapters without their own stop (e.g. Node) run the generic lane
		;(app as any).server = { stop() {} }
		await app.stop()

		expect(log).toEqual(['cleanup'])
	})

	it('leaves it alone on a handle-only app, whose stop() stays synchronous', async () => {
		const log: string[] = []

		const app = new Elysia()
			.decorate('db', handed(log))
			.get('/', ({ db }) => db.query())

		expect(await app.handle('/').then((r) => r.text())).toBe('rows')
		expect(app.stop()).toBeUndefined()

		await Bun.sleep(0)
		expect(log).toEqual([])
	})
})
