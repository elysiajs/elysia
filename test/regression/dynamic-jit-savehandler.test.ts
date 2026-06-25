/**
 * Regression: `#saveHandler` used to write the compiled handler into `~map`
 * under the *pattern* path for dynamic routes (e.g. `/N/:id`) on first request.
 * Dynamic routes resolve through the router, so that entry is never hit by a
 * real URL — it only wasted memory (one shadow entry per dynamic route, after
 * warmup) and let a literal `/N/:id` request run the handler with no params,
 * yielding a request-controlled 500.
 *
 * The fix skips `#saveHandler` for dynamic routes. These tests fail if it
 * comes back. See the performance/memory investigation.
 */
import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'

const req = (path: string) => new Request('http://e.ly' + path)

describe('dynamic-route jit saveHandler (memory + 500)', () => {
	it('does not accumulate a shadow ~map entry after warmup', async () => {
		const app = new Elysia().get('/u/:id', ({ params: { id } }) => id)
		void app.fetch

		// warm up: first request triggers jit compile + the old shadow write
		await app.handle(req('/u/7'))
		await app.handle(req('/u/7'))

		// the dynamic route lives in the router; the GET map must stay empty
		expect(Object.keys((app as any)['~map']?.GET ?? {})).toEqual([])
	})

	it('a literal `:id` segment is a normal param, not a 500', async () => {
		const app = new Elysia().get('/u/:id', ({ params: { id } }) => id)

		// warm up so the (previously) shadow entry would exist
		await app.handle(req('/u/7'))

		const res = await app.handle(req('/u/:id'))
		expect(res.status).toBe(200)
		expect(await res.text()).toBe(':id')
	})

	it('params stay correct across many warmed dynamic routes', async () => {
		const app = new Elysia()
		for (let i = 0; i < 5; i++)
			app.get(`/${i}/:id`, ({ params: { id } }) => `${i}:${id}`)
		void app.fetch

		for (let i = 0; i < 5; i++) await app.handle(req(`/${i}/9`))
		for (let i = 0; i < 5; i++)
			expect(await app.handle(req(`/${i}/9`)).then((r) => r.text())).toBe(
				`${i}:9`
			)
	})
})
