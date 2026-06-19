import { describe, it, expect } from 'bun:test'

import { rewriteTypeImport } from '../../src/plugin/treeshake'

/**
 * The AOT tree-shake transform rewrites `import { t } from 'elysia'` →
 * `import * as t from 'elysia/type'`. `elysia/type` is 1:1 with `t`, so the
 * rewrite is semantically identical (no validation needed) — it only changes
 * the import shape so static `t.X` access can tree-shake. Call sites untouched.
 */

describe('AOT tree-shake transform', () => {
	it('splits the barrel import so t becomes a shakeable namespace, call sites untouched', () => {
		const out = rewriteTypeImport(
			`import { Elysia, t } from 'elysia'\nt.Object({ a: t.String() })`
		)
		expect(out).toContain(`import { Elysia } from 'elysia'`)
		expect(out).toContain(`import * as t from 'elysia/type'`)
		// the value of the whole feature: the call site is byte-identical
		expect(out).toContain('t.Object({ a: t.String() })')
	})

	it('collapses a sole-t import to just the namespace', () => {
		expect(rewriteTypeImport(`import { t } from 'elysia'\nt.Number()`)).toBe(
			`import * as t from 'elysia/type'\nt.Number()`
		)
	})

	it('preserves a renamed import (t as x)', () => {
		expect(rewriteTypeImport(`import { t as x } from 'elysia'\nx.Object()`)).toBe(
			`import * as x from 'elysia/type'\nx.Object()`
		)
	})

	it('rewrites even when t is aliased/passed as a value — 1:1 makes it safe', () => {
		// the namespace has every key `t` had, so `x.Anything()` still resolves;
		// only the static accesses additionally tree-shake
		expect(
			rewriteTypeImport(`import { t } from 'elysia'\nconst x = t\nx.Object()`)
		).toBe(`import * as t from 'elysia/type'\nconst x = t\nx.Object()`)
	})

	it('never touches type-only or t-less imports', () => {
		const typeOnly = `import type { t } from 'elysia'\nconst x = 1`
		expect(rewriteTypeImport(typeOnly)).toBe(typeOnly)

		const noT = `import { Elysia } from 'elysia'\nnew Elysia()`
		expect(rewriteTypeImport(noT)).toBe(noT)
	})

	it('only touches the configured specifier', () => {
		const other = `import { t } from 'not-elysia'\nt.Object()`
		expect(rewriteTypeImport(other)).toBe(other)
	})

	it('honors custom from/typeFrom specifiers', () => {
		expect(
			rewriteTypeImport(`import { t } from '@scope/api'\nt.Object()`, {
				from: '@scope/api',
				typeFrom: '@scope/api/type'
			})
		).toBe(`import * as t from '@scope/api/type'\nt.Object()`)
	})
})
