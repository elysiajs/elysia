// Bun's native static lane handles HEAD and ETags differently from the JS lane.
// This accepted difference stays explicit because differential tests require equality.

import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../../src'

const withApp = async (
	nativeStaticResponse: boolean,
	run: (origin: string) => Promise<void>
) => {
	const app = new Elysia({ nativeStaticResponse } as any).get(
		'/head/static',
		'static'
	)

	app.listen(0)

	try {
		await run(`http://localhost:${app.server!.port}`)
	} finally {
		await app.stop(true)
	}
}

describe('HEAD on a promoted static GET route', () => {
	it('is answered 200 by Bun native promotion', async () => {
		await withApp(true, async (origin) => {
			const response = await fetch(`${origin}/head/static`, {
				method: 'HEAD'
			})

			expect(response.status).toBe(200)
			await expect(response.text()).resolves.toBe('')

			const get = await fetch(`${origin}/head/static`)
			expect(get.status).toBe(200)
			await expect(get.text()).resolves.toBe('static')
		})
	})

	it('is answered 404 by the JS lane — auto-HEAD is opt-in', async () => {
		await withApp(false, async (origin) => {
			const response = await fetch(`${origin}/head/static`, {
				method: 'HEAD'
			})

			expect(response.status).toBe(404)

			const get = await fetch(`${origin}/head/static`)
			expect(get.status).toBe(200)
			await expect(get.text()).resolves.toBe('static')
		})
	})
})

describe('conditional GET on a promoted static route', () => {
	it('is answered 304 by Bun native promotion and 200 by the JS lane', async () => {
		await withApp(true, async (origin) => {
			const first = await fetch(`${origin}/head/static`)
			expect(first.status).toBe(200)
			await expect(first.text()).resolves.toBe('static')

			const etag = first.headers.get('etag')
			expect(typeof etag).toBe('string')

			const revalidated = await fetch(`${origin}/head/static`, {
				headers: { 'if-none-match': etag! }
			})
			expect(revalidated.status).toBe(304)
			await expect(revalidated.text()).resolves.toBe('')

			// A stale ETag must not get a blanket 304.
			const stale = await fetch(`${origin}/head/static`, {
				headers: { 'if-none-match': '"stale"' }
			})
			expect(stale.status).toBe(200)
			await expect(stale.text()).resolves.toBe('static')

			await withApp(false, async (jsOrigin) => {
				const plain = await fetch(`${jsOrigin}/head/static`)
				expect(plain.status).toBe(200)
				expect(plain.headers.get('etag')).toBeNull()

				const jsRevalidated = await fetch(`${jsOrigin}/head/static`, {
					headers: { 'if-none-match': etag! }
				})
				expect(jsRevalidated.status).toBe(200)
				await expect(jsRevalidated.text()).resolves.toBe('static')
			})
		})
	})
})
