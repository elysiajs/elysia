import { describe, expect, it } from 'bun:test'

import * as typebox from 'typebox/type'

import { t } from '../../src/type'

/**
 * `t.String()`, `t.Number()`, `t.Boolean()` and `t.Integer()` return a frozen
 * singleton that is now hand-built instead of produced by `typebox/type` — that
 * is what keeps the modal schema from dragging ~1 MB of TypeBox into the eager
 * graph.
 *
 * Hand-building it means TypeBox's own `Memory.Create` result is no longer the
 * source of truth, so every observable detail has to be pinned: TypeBox
 * dispatches on `'~kind'` and it MUST stay non-enumerable (an enumerable
 * `'~kind'` leaks into JSON Schema output and into `{ ...schema }` clones), and
 * a `defineProperty` with a descriptor that carries no `value` would silently
 * store `undefined` and break `IsKind`.
 */
describe('hand-built type singletons', () => {
	const cases = [
		['String', t.String(), typebox.String()],
		['Number', t.Number(), typebox.Number()],
		['Boolean', t.Boolean(), typebox.Boolean()],
		['Integer', t.Integer(), typebox.Integer()]
	] as const

	for (const [name, ours, theirs] of cases)
		describe(name, () => {
			it('matches TypeBox descriptor for descriptor', () => {
				expect(Object.getOwnPropertyDescriptors(ours)).toEqual(
					Object.getOwnPropertyDescriptors(
						Object.freeze(theirs as object)
					)
				)
			})

			it('keeps the same key order', () => {
				expect(Object.getOwnPropertyNames(ours)).toEqual(
					Object.getOwnPropertyNames(theirs as object)
				)
			})

			it('keeps the same prototype', () => {
				expect(Object.getPrototypeOf(ours)).toBe(
					Object.getPrototypeOf(theirs as object)
				)
			})

			it('is frozen', () => {
				expect(Object.isFrozen(ours)).toBe(true)
			})

			it('serialises to the same JSON Schema', () => {
				expect(JSON.stringify(ours)).toBe(JSON.stringify(theirs))
			})

			it("keeps '~kind' readable but non-enumerable", () => {
				expect((ours as any)['~kind']).toBe(
					(theirs as any)['~kind']
				)
				expect(Object.keys(ours)).not.toContain('~kind')
			})
		})
})
