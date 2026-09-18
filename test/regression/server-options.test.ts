import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'

describe('server options', () => {
	it('does not mutate an options object reused across applications', () => {
		const options: Record<string, unknown> = { port: 0 }

		const first = new Elysia().get('/a', () => 'a').listen(options)
		const second = new Elysia().get('/b', () => 'b').listen(options)

		try {
			expect('fetch' in options).toBe(false)
			expect('routes' in options).toBe(false)
		} finally {
			;(first as any).stop?.()
			;(second as any).stop?.()
		}
	})
})
