import { describe, it, expect } from 'bun:test'
import { inferBodyReference, removeColonAlias } from '../../src/sucrose'

describe('remove colon alias', () => {
	it('remove aliased name', () => {
		const code = '{ headers: rs }'

		expect(removeColonAlias(code)).toBe(`{ headers }`)
	})

	it('remove aliased with part of keyword', () => {
		const code = '{ headers: reqHeaders }'

		expect(removeColonAlias(code)).toBe(`{ headers }`)
	})

    it('remove multiple aliased', () => {
		const code = '{ headers: rs, query: q }'

		expect(removeColonAlias(code)).toBe(`{ headers, query }`)
	})

    it('maintain same value if no aliased found', () => {
		const code = '{ headers, query }'

		expect(removeColonAlias(code)).toBe(`{ headers, query }`)
	})
})