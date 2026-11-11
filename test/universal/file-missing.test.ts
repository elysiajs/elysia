import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'
import { file } from '../../src/universal/file'

describe('file() on a missing path', () => {
	const MISSING = '/tmp/__elysia_does_not_exist_' + Date.now() + '.bin'

	it('does not throw at construction for a missing path', () => {
		expect(() => file(MISSING)).not.toThrow()
	})

	it('returns a Response without throwing from app.handle', async () => {
		const app = new Elysia().get('/missing', () => file(MISSING))

		const res = await app.handle(new Request('http://localhost/missing'))
		expect(res).toBeInstanceOf(Response)
	})

	it('surfaces the ENOENT only when the body stream is read', async () => {
		const app = new Elysia().get('/missing', () => file(MISSING))

		const res = await app.handle(new Request('http://localhost/missing'))

		let threw = false
		try {
			await res.arrayBuffer()
		} catch {
			threw = true
		}

		expect(threw).toBe(true)
	})
})
