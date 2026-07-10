import { describe, it, expect } from 'bun:test'

import { rewriteTypeImport } from '../../src/plugin/treeshake'

const expectToParse = (source: string) =>
	expect(() =>
		new Bun.Transpiler({ loader: 'ts' }).transformSync(source)
	).not.toThrow()

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

	it.each([
		['side-effect', `import './setup'`],
		['default', `import Default from './default'`],
		['namespace', `import * as helpers from './helpers'`],
		['type-only', `import type { Context } from './context'`],
		['named', `import { value } from './named'`],
		['default-plus-named', `import Default, { value } from './mixed'`]
	])('does not consume a preceding %s import', async (_, prefix) => {
		const out = await rewriteTypeImport(
			`${prefix}\nimport { Elysia, t } from 'elysia'\nt.String()`
		)

		expect(out).toStartWith(`${prefix}\nimport { Elysia } from 'elysia'`)
		expectToParse(out)
	})

	it('rewrites default-plus-named and multiline imports without corrupting syntax', async () => {
		const out = await rewriteTypeImport(`import ElysiaDefault, {
	Elysia,
	type Context,
	t as schema
} from 'elysia'
schema.String()`)

		expect(out).toContain(
			`import ElysiaDefault, { Elysia, type Context } from 'elysia'\nimport * as schema from 'elysia/type'`
		)
		expectToParse(out)
	})

	it.each([
		['commented', `import { /* keep, comma */ Elysia, t } from 'elysia'`],
		['string-named', `import { 'x,y' as x, t } from 'elysia'`]
	])('leaves %s complex valid named imports untouched', async (_, source) => {
		const out = await rewriteTypeImport(source)

		expect(out).toBe(source)
		expectToParse(out)
	})

	// Import-shaped text that merely LOOKS like an import must never be
	// rewritten, or the transform silently corrupts user code.
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
