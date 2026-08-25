// @ts-nocheck
import { describe, expect, it } from 'bun:test'
import { clearSucroseCache, sucrose } from '../../src/sucrose'

describe('sucrose inference cache', () => {
	it('keeps inference isolated between distinct handlers', () => {
		clearSucroseCache(null)

		const query = sucrose((context: any) => context.query.name, undefined)
		const body = sucrose((context: any) => context.body, undefined)

		expect(query.query).toBe(true)
		expect(query.body).toBe(false)
		expect(body.body).toBe(true)
		expect(body.query).toBe(false)
	})

	it('returns the same inference for a cached handler', () => {
		clearSucroseCache(null)
		const handler = (context: any) => context.headers['x-auth']

		const first = sucrose(handler, undefined)
		const second = sucrose(handler, undefined)

		expect(second).toEqual(first)
	})
})
