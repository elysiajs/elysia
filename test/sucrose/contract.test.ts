// @ts-nocheck
/**
 * Executable contract for context-use inference.
 *
 * Every fixture currently has `passesToday: true` and is asserted to satisfy
 * its `expect` directly.
 * The `passesToday` mechanism remains available for future open defects:
 * - `passesToday: true` fixtures are asserted to satisfy their `expect`.
 * - `passesToday: false` fixtures are asserted to CURRENTLY VIOLATE their
 * `expect` (a "documents current defect" assertion). This does two things:
 * 1. proves the `passesToday` flag is accurate (not guessed), and
 * 2. flips red the moment a fix lands — at which point the maintainer
 * sets `passesToday: true` and the fixture becomes a plain assertion.
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
			// A failing fixture documents current behavior and turns red when fixed.
			it(`[${fx.defect}] documents current defect — ${fx.name}`, () => {
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
	// removeColonAlias must drop the whole `:alias` span and reduce a
	// braced rename to the bare keyword, preserving surrounding formatting.
	it('removeColonAlias reduces braced rename to bare keyword', () => {
		expect(removeColonAlias('{headers:rs}')).toBe('{headers}')
		expect(removeColonAlias('{query:q}')).toBe('{query}')
		// Spaced form keeps its formatting (space before the closing brace).
		expect(removeColonAlias('{ headers: rs }')).toBe('{ headers }')
		expect(removeColonAlias('{ headers: reqHeaders }')).toBe('{ headers }')
	})

	it('findAlias re-inject yields the bare keyword', () => {
		// `const {query:q} = c` → the re-injected destructure block reduces to
		// `{query}`, so downstream retrieveRootparameters sees key `query` and
		// the channel is kept. (`q.a` is a property read on `q`, not an alias of
		// `c`, so `a` is correctly absent — the old trailing `a` was garbage.)
		expect(findAlias('c', '{const{query:q}=c;q.a}')).toEqual(['{query}'])
	})

	// minified `=alias` must return the same alias list as the spaced form,
	// with no lost or garbage aliases.
	it('minified transitive aliases match the spaced form', () => {
		// spaced baseline
		expect(findAlias('body', '{ const a = body, b = a }')).toEqual([
			'a',
			'b'
		])
		// minified must match the spaced form exactly (no lost second alias)
		expect(findAlias('body', '{const a=body,b=a}')).toEqual(['a', 'b'])
		// three aliases minified → clean transitive list, no garbage
		expect(findAlias('body', '{const a=body,b=a,c=b}')).toEqual([
			'a',
			'b',
			'c'
		])
	})
})
