import { describe, it, expect } from 'bun:test'

import { rewriteTypeImport } from '../../src/plugin/treeshake'

/**
 * The AOT tree-shake transform rewrites `import { t } from 'elysia'` →
 * `import * as t from 'elysia/type'`. `elysia/type` is 1:1 with `t`, so the
 * rewrite is semantically identical (no validation needed) — it only changes
 * the import shape so static `t.X` access can tree-shake. Call sites untouched.
 */

describe('AOT tree-shake transform', () => {
	it('splits the barrel import so t becomes a shakeable namespace, call sites untouched', async () => {
		const out = await rewriteTypeImport(
			`import { Elysia, t } from 'elysia'\nt.Object({ a: t.String() })`
		)
		expect(out).toContain(`import { Elysia } from 'elysia'`)
		expect(out).toContain(`import * as t from 'elysia/type'`)
		// the value of the whole feature: the call site is byte-identical
		expect(out).toContain('t.Object({ a: t.String() })')
	})

	it('collapses a sole-t import to just the namespace', async () => {
		expect(await rewriteTypeImport(`import { t } from 'elysia'\nt.Number()`)).toBe(
			`import * as t from 'elysia/type'\nt.Number()`
		)
	})

	it('preserves a renamed import (t as x)', async () => {
		expect(await rewriteTypeImport(`import { t as x } from 'elysia'\nx.Object()`)).toBe(
			`import * as x from 'elysia/type'\nx.Object()`
		)
	})

	it('rewrites even when t is aliased/passed as a value — 1:1 makes it safe', async () => {
		// the namespace has every key `t` had, so `x.Anything()` still resolves;
		// only the static accesses additionally tree-shake
		expect(
			await rewriteTypeImport(`import { t } from 'elysia'\nconst x = t\nx.Object()`)
		).toBe(`import * as t from 'elysia/type'\nconst x = t\nx.Object()`)
	})

	it('never touches type-only or t-less imports', async () => {
		const typeOnly = `import type { t } from 'elysia'\nconst x = 1`
		expect(await rewriteTypeImport(typeOnly)).toBe(typeOnly)

		const noT = `import { Elysia } from 'elysia'\nnew Elysia()`
		expect(await rewriteTypeImport(noT)).toBe(noT)
	})

	it('only touches the configured specifier', async () => {
		const other = `import { t } from 'not-elysia'\nt.Object()`
		expect(await rewriteTypeImport(other)).toBe(other)
	})

	it('honors custom from/typeFrom specifiers', async () => {
		expect(
			await rewriteTypeImport(`import { t } from '@scope/api'\nt.Object()`, {
				from: '@scope/api',
				typeFrom: '@scope/api/type'
			})
		).toBe(`import * as t from '@scope/api/type'\nt.Object()`)
	})

	// M37: the transform runs on es-module-lexer spans, not a regex — text
	// that merely LOOKS like an import must never be rewritten, or the
	// transform silently corrupts user code (docs generators, fixtures, ...)
	it('never rewrites import-shaped text inside a template literal', async () => {
		const doc = "const doc = `\nimport { t } from 'elysia'\n`\nexport {}"
		expect(await rewriteTypeImport(doc)).toBe(doc)
	})

	it('never rewrites a commented-out import', async () => {
		const commented = `// import { t } from 'elysia'\nexport {}`
		expect(await rewriteTypeImport(commented)).toBe(commented)
	})

	it('leaves a syntactically invalid file for the bundler to diagnose', async () => {
		const broken = `import { t from 'elysia'\nt.Object(`
		expect(await rewriteTypeImport(broken)).toBe(broken)
	})
})
