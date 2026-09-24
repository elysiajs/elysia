// @ts-nocheck

import { describe, it, expect } from 'bun:test'
import { sucrose } from '../../src/sucrose'
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
