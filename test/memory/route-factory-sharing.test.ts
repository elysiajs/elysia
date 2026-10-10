import { describe, expect, it } from 'bun:test'
import { heapStats } from 'bun:jsc'

import { Elysia, t } from '../../src'

const heap = () => {
	Bun.gc(true)
	Bun.gc(true)
	const h = heapStats()

	return h.heapSize + h.extraMemorySize
}

describe('JIT route factory sharing', () => {
	// distinct schemas emit identical route source; per-schema validator
	// sources churn JSC's source cache, after which every identical
	// `new Function` links its own code unless the factory is shared
	it('distinct-schema routes do not each link their own route code', async () => {
		const app = new Elysia()
		const hit = async (from: number, to: number) => {
			for (let i = from; i < to; i++) {
				const res = await app.handle(
					new Request(`http://localhost/r${i}`, {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: `{"k${i}":"a","n":1}`
					})
				)
				expect(res.status).toBe(200)
				await res.text()
			}
		}

		const N = 400
		for (let i = 0; i < N + 20; i++)
			app.post(
				`/r${i}`,
				{ body: t.Object({ ['k' + i]: t.String(), n: t.Number() }) },
				({ body }) => body.n
			)

		// warm: compile the fetch and the first few routes
		await hit(N, N + 20)
		const before = heap()
		await hit(0, N)
		const perRoute = (heap() - before) / N

		// shared ~9.4 KB, a factory per route ~45.7 KB
		expect(perRoute).toBeLessThan(20_000)
	})
})
