// @ts-nocheck
/**
 * Executable enforcement of design/sucrose-contract.md.
 *
 * The suite is GREEN on the current tree while making the H5/H26/M29/M30
 * defects executable specs:
 *   - `passesToday: true` fixtures are asserted to satisfy their `expect`.
 *   - `passesToday: false` fixtures are asserted to CURRENTLY VIOLATE their
 *     `expect` (a "documents current defect" assertion). This does two things:
 *       1. proves the `passesToday` flag is accurate (not guessed), and
 *       2. flips red the moment the Phase-2 fix lands — at which point the
 *          maintainer sets `passesToday: true` and the fixture becomes a plain
 *          contract assertion. i.e. the defect cannot be fixed silently.
 */

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

/** Does the inference satisfy every asserted channel in `exp`? */
const satisfies = (actual: any, exp: Record<string, boolean>) =>
	Object.entries(exp).every(([k, v]) => actual[k] === v)

describe('sucrose contract — fixture corpus', () => {
	for (const fx of fixtures) {
		if (fx.passesToday) {
			it(`[${fx.class}] ${fx.name}`, () => {
				const actual = infer(fx.fn)
				for (const [channel, want] of Object.entries(fx.expect))
					expect(actual[channel]).toBe(want)
			})
		} else {
			// Executable defect spec. GREEN today because the fixture currently
			// FAILS the contract; will go RED when the Phase-2 fix lands.
			it(`[${fx.bug}] documents current defect — ${fx.name}`, () => {
				const actual = infer(fx.fn)
				expect(satisfies(actual, fx.expect)).toBe(false)
			})
		}
	}
})

describe('sucrose contract — passesToday flag is empirically accurate', () => {
	// Guards against a stale flag: a fixture marked passesToday must actually
	// pass, and one marked failing must actually fail. (Redundant with the
	// per-fixture assertions above, but keeps the invariant explicit.)
	it('every flag matches measured behavior', () => {
		for (const fx of fixtures) {
			const actual = infer(fx.fn)
			expect(satisfies(actual, fx.expect)).toBe(fx.passesToday)
		}
	})
})

describe('sucrose contract — unit-level defect repros', () => {
	// H26: removeColonAlias off-by-one leaves the alias tail glued to the
	// keyword when braces are present. Directly observable at the unit
	// boundary; the end-to-end path can mask it via a robust re-parse.
	it('[H26] removeColonAlias mangles braced rename today', () => {
		// current-wrong: tail char `s` glued, key becomes `headerss`
		expect(removeColonAlias('{headers:rs}')).toBe('{headerss}')
		expect(removeColonAlias('{query:q}')).toBe('{queryq}')
		// Post-fix target (kept as documentation, asserted after the fix):
		//   expect(removeColonAlias('{headers:rs}')).toBe('{headers}')
	})

	it('[H26] findAlias re-inject surfaces the mangled key today', () => {
		// `const {query:q} = c` → the re-injected destructure block is mangled
		// to `{queryq}`, so downstream retrieveRootparameters sees key `queryq`
		// (not `query`) — the channel would be dropped.
		expect(findAlias('c', '{const{query:q}=c;q.a}')).toEqual(['{queryq}', 'a'])
		// Post-fix target: ['{query}', 'a']
	})

	// M29: minified `=alias` over-slices by 2. Two aliases → the second is lost;
	// three aliases → garbage alias strings appear.
	it('[M29] minified transitive alias is dropped/corrupted today', () => {
		// spaced baseline is correct
		expect(findAlias('body', '{ const a = body, b = a }')).toEqual(['a', 'b'])
		// minified loses the second alias (over-slice by 2)
		expect(findAlias('body', '{const a=body,b=a}')).toEqual(['a'])
		// three aliases minified → duplicated/garbage entries
		expect(findAlias('body', '{const a=body,b=a,c=b}')).toEqual([
			'a',
			'a=body,b',
			'b'
		])
		// Post-fix target:
		//   ['a','b'] and ['a','b','c'] respectively, no garbage.
	})
})
