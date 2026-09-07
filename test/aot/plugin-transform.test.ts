import { describe, it, expect } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { rewriteTypeImport } from '../../src/plugin/aot/treeshake'
import { aot as viteAot } from '../../src/plugin/aot/vite'
import { createAotPluginHooks } from '../../src/plugin/aot/hooks'
import { resolveElysiaRoot } from '../../src/plugin/aot/core'
import { Compiled } from '../../src/compile/aot'
import { Validator } from '../../src/validator'

describe('AOT plugin source transforms', () => {
	it('refreshes static clone omission without touching a nested package', async () => {
		const packageRoot = resolve(import.meta.dir, '../..')
		const directory = await mkdtemp(resolve(import.meta.dir, '_clone-hooks-'))
		const entry = resolve(directory, 'app.ts')
		const previousMode = process.env.ELYSIA_AOT_STATIC_CLONE_MODE
		const input = 'export const staticCloneResolver = () => undefined\n'
		const omitted = 'export const staticCloneResolver = undefined\n'
		const leaf = resolve(
			packageRoot,
			'src/compile/handler/static-clone-resolver.ts'
		)

		try {
			await writeFile(
				entry,
				`import { Elysia, t } from ${JSON.stringify(resolve(packageRoot, 'src/index.ts'))}\n` +
					`const mode = process.env.ELYSIA_AOT_STATIC_CLONE_MODE\n` +
					`if (mode === 'throw') throw new Error('static clone rebuild boom')\n` +
					`export const app = new Elysia().get('/plain', () => 'plain')\n` +
					`if (mode === 'mixed') app.get('/clone', { response: t.Any(), afterHandle() {} }, { value: 'clone' })\n`
			)
			expect(resolveElysiaRoot(entry)).toBe(packageRoot)
			process.env.ELYSIA_AOT_STATIC_CLONE_MODE = 'plain'
			const hooks = createAotPluginHooks(entry, { production: false })
			await hooks.buildStart()

			for (const suffix of [
				'src/compile/handler/static-clone-resolver.ts',
				'dist/compile/handler/static-clone-resolver.mjs',
				'dist/compile/handler/static-clone-resolver.js'
			]) {
				expect(
					await hooks.transform(input, resolve(packageRoot, suffix))
				).toBe(omitted)
				expect(
					await hooks.transform(
						input,
						resolve(packageRoot, 'node_modules/elysia', suffix)
					)
				).toBeUndefined()
			}

			// A later route's alias must retain the resolver on this same hook instance.
			process.env.ELYSIA_AOT_STATIC_CLONE_MODE = 'mixed'
			await hooks.buildStart()
			expect(await hooks.transform(input, leaf)).toBeUndefined()

			process.env.ELYSIA_AOT_STATIC_CLONE_MODE = 'plain'
			await hooks.buildStart()
			expect(await hooks.transform(input, leaf)).toBe(omitted)

			process.env.ELYSIA_AOT_STATIC_CLONE_MODE = 'throw'
			await expect(hooks.buildStart()).rejects.toThrow(
				'static clone rebuild boom'
			)

			process.env.ELYSIA_AOT_STATIC_CLONE_MODE = 'mixed'
			await hooks.buildStart()
			expect(await hooks.transform(input, leaf)).toBeUndefined()
		} finally {
			if (previousMode === undefined)
				delete process.env.ELYSIA_AOT_STATIC_CLONE_MODE
			else process.env.ELYSIA_AOT_STATIC_CLONE_MODE = previousMode
			Compiled.clear()
			Validator.clear()
			await rm(directory, { recursive: true, force: true })
		}
	})

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
			expect(rewriteTypeImport(userCode)).toBe(
				`import * as t from 'elysia/type'\nt.Number()`
			)
		})
	})

	describe('import attributes', () => {
		it('keeps a with-attribute on the namespace import', async () => {
			expect(
				rewriteTypeImport(
					`import { t } from 'elysia' with { type: 'macro' }\nt.Number()`
				)
			).toBe(
				`import * as t from 'elysia/type' with { type: 'macro' }\nt.Number()`
			)
		})

		it('copies a with-attribute to both split imports', async () => {
			expect(
				rewriteTypeImport(
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
				rewriteTypeImport(
					`import { t } from 'elysia' assert { type: 'macro' }\nt.X()`
				)
			).toBe(
				`import * as t from 'elysia/type' assert { type: 'macro' }\nt.X()`
			)
		})

		it('does not swallow a trailing semicolon as an attribute', async () => {
			expect(
				rewriteTypeImport(`import { t } from 'elysia';\nt.X()`)
			).toBe(`import * as t from 'elysia/type';\nt.X()`)
		})
	})
})
