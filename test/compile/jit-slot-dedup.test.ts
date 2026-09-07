import { describe, expect, it } from 'bun:test'
import { Elysia, t } from '../../src'
import { createAdapter } from '../../src/adapter'
import { WebStandardAdapter } from '../../src/adapter/web-standard'

describe('JIT dependency slots', () => {
	it('binds both parser slots when they share one function', async () => {
		const sharedParser = (ctx: any) => ctx.request.text()

		const adapter = createAdapter({
			...WebStandardAdapter,
			parse: {
				...WebStandardAdapter.parse,
				json: sharedParser,
				default: sharedParser
			}
		})

		const app = new Elysia({ adapter }).post('/', ({ body }) => body)

		// An unrecognized content type selects the default parser slot.
		const res = await app.handle(
			new Request('http://localhost/', {
				method: 'POST',
				headers: { 'content-type': 'application/octet-stream' },
				body: 'hello'
			})
		)

		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('hello')
	})

	it('keeps body validation callable when checks share a dependency', async () => {
		// Body Check and Decode links reuse one validator slot.
		const app = new Elysia().post(
			'/echo',
			{ body: t.Object({ x: t.Number() }) },
			({ body }) => new Response(JSON.stringify(body))
		)

		const res = await app.handle(
			new Request('http://localhost/echo', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ x: 1 })
			})
		)

		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ x: 1 })
	})
})
