import Elysia, { t } from '../../src'
import { describe, expect, it } from 'bun:test'

describe('TypeSystem - Uint8Array', () => {

	it('Integrate', async () => {
		const app = new Elysia().post('/', ({ body }) => body, {
			body: t.Uint8Array(),
			response: t.Uint8Array()
		})

		const response = await app.handle(
			new Request('http://localhost', {
				method: 'POST',
				body: new TextEncoder().encode('可愛くてごめん'),
				headers: { 'content-type': 'application/octet-stream' }
			})
		)

		expect(await response.text()).toBe('可愛くてごめん')
	})
})
