import { describe, expect, it } from 'bun:test'

import {
	mergeDeep,
	cloneHook,
	mergeHook,
	flattenChain,
	type ChainNode
} from '../../src/utils'

// idx26 — mergeDeep dropped the try/catch around property assignment.
// WHY it matters: registration-time merges (.decorate('override', name, value)
// / .state('override', ...)) re-run mergeDeep against a previously stored named
// value. If that value carries a getter-only / non-writable own property, the
// bare `target[key] = value` throws TypeError in ESM strict mode and crashes the
// whole .decorate()/.state() call. main swallowed it; kiana must too. A getter
// stays untouched rather than crashing the merge.
describe('mergeDeep — getter-only / non-writable property (idx26)', () => {
	it('does not throw when overriding a getter-only property', () => {
		const target: Record<string, unknown> = {}
		Object.defineProperty(target, 'sameKey', {
			get: () => 1,
			enumerable: true,
			configurable: false
		})

		expect(() => mergeDeep(target, { sameKey: 2 }, undefined, true)).not.toThrow()
		// assignment was swallowed: getter still returns its original value
		expect((target as any).sameKey).toBe(1)
	})

	it('does not throw when recursively merging into a non-writable object property', () => {
		const inner = { a: 1 }
		const target: Record<string, unknown> = {}
		Object.defineProperty(target, 'cfg', {
			value: inner,
			writable: false,
			enumerable: true,
			configurable: false
		})

		expect(() =>
			mergeDeep(target, { cfg: { b: 2 } }, undefined, true)
		).not.toThrow()
	})
})

// idx42 — appendInto must treat the `schema` guard marker as a scalar mode
// string, not an array element. WHY: a guard node carries `schema: 'standalone'`
// | 'override' as a mode flag (consumed elsewhere as a scalar, and dropped on
// cross-`.use()` propagation). Pushing it into an array yields a bogus
// `schema: ['standalone', ...]` type-lie at the public `routes` introspection
// boundary. `schemas` (plural, the real extracted schema objects) MUST still
// accumulate as an array.
describe('flattenChain — schema marker stays scalar (idx42)', () => {
	it('keeps the schema marker as a scalar string, not an array', () => {
		const parent: ChainNode = {
			added: { schema: 'override' as any },
			parent: undefined
		}
		const child: ChainNode = {
			added: { schema: 'standalone' as any },
			parent
		}

		const flat = flattenChain(child) as any

		expect(Array.isArray(flat.schema)).toBe(false)
		// last-write-wins scalar (child node walked after parent)
		expect(flat.schema).toBe('standalone')
	})

	it('still accumulates the schemas array', () => {
		const schemaA = { body: { type: 'string' } }
		const schemaB = { query: { type: 'string' } }
		const parent: ChainNode = {
			added: { schemas: [schemaA] as any },
			parent: undefined
		}
		const child: ChainNode = {
			added: { schemas: [schemaB] as any },
			parent
		}

		const flat = flattenChain(child) as any

		expect(Array.isArray(flat.schemas)).toBe(true)
		expect(flat.schemas).toHaveLength(2)
	})
})

// idx48 — cloneHook must deep-copy ALL array hook keys (incl. `schemas` and
// `derive`), not only `eventProperties`. WHY: applyHook does
// mergeHook(cloneHook(local), appHook); mergeHook's mergeArray mutates side `a`
// in place. If cloneHook aliases `schemas`/`derive`, the merge mutates the
// route's SHARED original local hook, so on any recompile inherited entries
// accumulate/duplicate. The clone must own fresh arrays.
describe('cloneHook — deep-copies schemas/derive (idx48)', () => {
	it('does not alias the schemas array', () => {
		const local = { schemas: [{ body: { type: 'string' } }] as any }
		const cloned = cloneHook(local)

		expect(cloned.schemas).not.toBe(local.schemas)
		expect(cloned.schemas).toEqual(local.schemas)
	})

	it('does not alias the derive array', () => {
		const fn = () => ({})
		const local = { derive: [fn] as any }
		const cloned = cloneHook(local)

		expect((cloned as any).derive).not.toBe((local as any).derive)
		expect((cloned as any).derive).toEqual((local as any).derive)
	})

	it('mergeHook after cloneHook does not mutate the original schemas', () => {
		const local = { schemas: [{ body: { type: 'string' } }] as any }
		const appHook = { schemas: [{ query: { type: 'string' } }] as any }

		// simulate a recompile firing the merge twice
		mergeHook(cloneHook(local), appHook)
		mergeHook(cloneHook(local), appHook)

		// the route's shared original must stay length 1 — no accumulation
		expect(local.schemas).toHaveLength(1)
	})
})
