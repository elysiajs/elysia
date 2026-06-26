import { describe, expect, it } from 'bun:test'

import { buildStaticDispatch } from '../../src/handler/utils'

// buildStaticDispatch turns a { method: { path: slot } } table into a
// (method, path) => slot | undefined function. On Bun it generates a nested
// string-switch with the slot baked in as a literal; either way the result must
// be an exact drop-in for `map[method]?.[path]`. These tests fail loudly if the
// generated switch ever diverges from that lookup.

describe('buildStaticDispatch', () => {
	it('returns the slot for every registered entry', () => {
		const map = {
			GET: { '/': 0, '/users': 1, '/users/1': 2 },
			POST: { '/users': 3 },
			WS: { '/ws': 4 },
			'*': { '/any': 5 }
		}
		const find = buildStaticDispatch(map)

		for (const method in map)
			for (const path in (map as any)[method])
				expect(find(method, path)).toBe((map as any)[method][path])
	})

	it('returns undefined for unknown method, unknown path, and empty map', () => {
		const find = buildStaticDispatch({ GET: { '/x': 0 } })

		expect(find('GET', '/missing')).toBeUndefined()
		expect(find('DELETE', '/x')).toBeUndefined()
		expect(buildStaticDispatch({})('GET', '/x')).toBeUndefined()
	})

	it('resolves slot 0 (a falsy slot must not read as a miss)', () => {
		const find = buildStaticDispatch({ GET: { '/first': 0 } })
		expect(find('GET', '/first')).toBe(0)
	})

	it('escapes paths with quotes/backslashes/newlines (no codegen injection)', () => {
		const map = {
			GET: {
				'/a"b': 0,
				'/a\\b': 1,
				'/a\nb': 2,
				'/${x}': 3
			}
		}
		const find = buildStaticDispatch(map)

		for (const path in map.GET)
			expect(find('GET', path)).toBe((map.GET as any)[path])
		expect(find('GET', '/ab')).toBeUndefined()
	})
})
