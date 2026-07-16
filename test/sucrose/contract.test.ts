// @ts-nocheck

import { describe, it, expect } from 'bun:test'
import { sucrose, findAlias, removeColonAlias } from '../../src/sucrose'
import { fixtures } from './fixtures'

const LIFECYCLE = {
	afterHandle: [],
	beforeHandle: [],
	error: [],
	mapResponse: [],
	afterResponse: [],
	parse: [],
	request: [],
	start: [],
	stop: [],
	trace: [],
	transform: []
}

const infer = (fn: any) => sucrose(fn, LIFECYCLE as any)

const matchesExpectedProperties = (
	actual: any,
	expected: Record<string, boolean>
) => Object.entries(expected).every(([key, value]) => actual[key] === value)

describe('context property inference', () => {
	for (const fixture of fixtures) {
		if (fixture.passesToday) {
			it(`[${fixture.class}] ${fixture.name}`, () => {
				const actual = infer(fixture.fn)
				for (const [channel, expected] of Object.entries(
					fixture.expect
				))
					expect(actual[channel]).toBe(expected)
			})
		} else {
			it(`[unsupported] ${fixture.name}`, () => {
				const actual = infer(fixture.fn)
				expect(matchesExpectedProperties(actual, fixture.expect)).toBe(
					false
				)
			})
		}
	}
})

describe('context alias parsing', () => {
	it('removeColonAlias reduces braced rename to bare keyword', () => {
		expect(removeColonAlias('{headers:rs}')).toBe('{headers}')
		expect(removeColonAlias('{query:q}')).toBe('{query}')
		expect(removeColonAlias('{ headers: rs }')).toBe('{ headers }')
		expect(removeColonAlias('{ headers: reqHeaders }')).toBe('{ headers }')
	})

	it('findAlias preserves a renamed destructured key', () => {
		expect(findAlias('c', '{const{query:q}=c;q.a}')).toEqual(['{query}'])
	})

	it('minified transitive aliases match the spaced form', () => {
		expect(findAlias('body', '{ const a = body, b = a }')).toEqual([
			'a',
			'b'
		])
		expect(findAlias('body', '{const a=body,b=a}')).toEqual(['a', 'b'])
		expect(findAlias('body', '{const a=body,b=a,c=b}')).toEqual([
			'a',
			'b',
			'c'
		])
	})
})
