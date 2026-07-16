import { describe, it, expect } from 'bun:test'

import { rewriteTypeImport } from '../../src/plugin/aot/treeshake'
import { aot as viteAot } from '../../src/plugin/aot/vite'

describe('AOT plugin source transforms', () => {
	describe('registerFrom must not disable tree-shaking', () => {
		it('vite transform still rewrites t when registerFrom is custom', async () => {
			const plugin = viteAot('src/index.ts', {
				registerFrom: './elysia-wrapper'
			})

			const out = await plugin.transform(
				`import { Elysia, t } from 'elysia'\nt.Object({ a: t.String() })`,
				'/project/src/handlers.ts'
			)

			expect(out).toBeDefined()
			expect(out).toContain(`import * as t from 'elysia/type'`)
			expect(out).toContain(`import { Elysia } from 'elysia'`)
			expect(out).toContain('t.Object({ a: t.String() })')
		})

		it('uses the type-import source independently of registerFrom', async () => {
			const userCode = `import { t } from 'elysia'\nt.Number()`
			expect(
				await rewriteTypeImport(userCode, {
					from: '/abs/monorepo/src/compile/index.ts'
				})
			).toBe(userCode)

			expect(await rewriteTypeImport(userCode)).toBe(
				`import * as t from 'elysia/type'\nt.Number()`
			)
		})
	})

	describe('import attributes', () => {
		it('keeps a with-attribute on the namespace import', async () => {
			expect(
				await rewriteTypeImport(
					`import { t } from 'elysia' with { type: 'macro' }\nt.Number()`
				)
			).toBe(
				`import * as t from 'elysia/type' with { type: 'macro' }\nt.Number()`
			)
		})

		it('copies a with-attribute to both split imports', async () => {
			expect(
				await rewriteTypeImport(
					`import { Elysia, t } from 'elysia' with { type: 'json' }\nt.Object()`
				)
			).toBe(
				`import { Elysia } from 'elysia' with { type: 'json' }\n` +
					`import * as t from 'elysia/type' with { type: 'json' }\n` +
					`t.Object()`
			)
		})

		it('handles the legacy `assert` attribute keyword', async () => {
			expect(
				await rewriteTypeImport(
					`import { t } from 'elysia' assert { type: 'macro' }\nt.X()`
				)
			).toBe(
				`import * as t from 'elysia/type' assert { type: 'macro' }\nt.X()`
			)
		})

		it('does not swallow a trailing semicolon as an attribute', async () => {
			expect(
				await rewriteTypeImport(`import { t } from 'elysia';\nt.X()`)
			).toBe(`import * as t from 'elysia/type';\nt.X()`)
		})
	})
})
