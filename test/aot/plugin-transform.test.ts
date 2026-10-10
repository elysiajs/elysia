import { describe, it, expect } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { rewriteTypeImport } from '../../src/plugin/aot/treeshake'
import { aot as bunAot } from '../../src/plugin/aot/bun'
import { aot as viteAot } from '../../src/plugin/aot/vite'
import {
	createAotPluginHooks,
	createTypeboxWiringHooks
} from '../../src/plugin/aot/hooks'
import { resolveElysiaRoot } from '../../src/plugin/aot/core'
import { Compiled } from '../../src/compile/aot'
import { Validator } from '../../src/validator'

describe('AOT plugin source transforms', () => {
	// Sealed builds still run user `t.*()`, so typebox-type must always resolve
	// to its statically-importing `-live` mirror; a loader-less runtime crashes
	// at startup otherwise
	it('always re-routes typebox-type to its live mirror', () => {
		const packageRoot = resolve(import.meta.dir, '../..')
		const hooks = createAotPluginHooks(resolve(packageRoot, 'src/index.ts'))

		for (const leaf of [
			'src/type/typebox-type.ts',
			'dist/type/typebox-type.mjs'
		])
			expect(hooks.transform('', resolve(packageRoot, leaf))).toContain(
				`export * from './typebox-type-live`
			)
	})

	it('always re-routes typebox-system-lite to the full system', () => {
		const packageRoot = resolve(import.meta.dir, '../..')
		const hooks = createAotPluginHooks(resolve(packageRoot, 'src/index.ts'))

		for (const file of [
			'src/type/typebox-system-lite.ts',
			'dist/type/typebox-system-lite.mjs',
			'dist/type/typebox-system-lite.js'
		])
			expect(hooks.transform('', resolve(packageRoot, file))).toBe(
				`export * from 'typebox/system'\n`
			)
	})

	// Their literal `require` would drag TypeBox / exact-mirror into sealed
	// builds; every other mode re-routes the caller to `-live` and never reaches it
	it('always stubs the literal require leaves', () => {
		const packageRoot = resolve(import.meta.dir, '../..')
		const hooks = createAotPluginHooks(resolve(packageRoot, 'src/index.ts'))

		for (const [leaf, stub] of [
			[
				'type/typebox-value-require',
				'export const requireTypebox = () => undefined\nexport const importTypebox = () => undefined\n'
			],
			[
				'type/validator/exact-mirror-require',
				'export const requireExactMirror = () => undefined\n'
			]
		])
			for (const file of [
				`src/${leaf}.ts`,
				`dist/${leaf}.mjs`,
				`dist/${leaf}.js`
			])
				expect(hooks.transform('', resolve(packageRoot, file))).toBe(
					stub
				)
	})

	it('wires only the static TypeBox leaves without an entry', () => {
		const packageRoot = resolve(import.meta.dir, '../..')
		const hooks = createTypeboxWiringHooks()
		const cases = [
			[
				'type/typebox-type',
				(extension: string) =>
					`export * from './typebox-type-live${extension}'\n`
			],
			[
				'type/typebox-value',
				(extension: string) =>
					`export * from './typebox-value-live${extension}'\n`
			]
		] as const

		for (const [directory, fileExtension, importExtension] of [
			['src', '.ts', ''],
			['dist', '.mjs', '.mjs']
		] as const)
			for (const [leaf, source] of cases)
				expect(
					hooks.transform(
						'original',
						resolve(
							packageRoot,
							`${directory}/${leaf}${fileExtension}`
						)
					)
				).toBe(source(importExtension))

		for (const leaf of [
			...cases.map(([leaf]) => leaf),
			'type/typebox-value-require',
			'type/validator/exact-mirror',
			'type/validator/exact-mirror-require'
		])
			expect(
				hooks.transform(
					'original',
					resolve(packageRoot, `dist/${leaf}.js`)
				)
			).toBeUndefined()

		for (const [directory, extension] of [
			['src', '.ts'],
			['dist', '.mjs']
		] as const)
			for (const leaf of [
				'type/typebox-value-require',
				'type/validator/exact-mirror',
				'type/validator/exact-mirror-require'
			])
				expect(
					hooks.transform(
						'original',
						resolve(packageRoot, `${directory}/${leaf}${extension}`)
					)
				).toBeUndefined()

		for (const leaf of [
			'src/type/index.ts',
			'src/type/bridge.ts',
			'src/type/compat.ts',
			'src/universal/is-production.ts'
		])
			expect(
				hooks.transform('original', resolve(packageRoot, leaf))
			).toBeUndefined()

		const nested = resolve(
			packageRoot,
			'node_modules/nested/node_modules/elysia/src/type/typebox-type.ts'
		)
		expect(hooks.transform('original', nested)).toBe(
			`export * from './typebox-type-live'\n`
		)
		expect(hooks.isTransformCandidate(nested)).toBe(true)

		const unrelated = '/tmp/app/src/type/typebox-type.ts'
		expect(hooks.transform('original', unrelated)).toBeUndefined()
		expect(hooks.isTransformCandidate(unrelated)).toBe(false)
	})

	it('rejects AOT options without an entry', () => {
		expect(() => bunAot(undefined, { production: true })).toThrow(
			'[elysia-aot] options require an entry'
		)
	})

	it('refreshes static clone omission without touching a nested package', async () => {
		const packageRoot = resolve(import.meta.dir, '../..')
		const directory = await mkdtemp(
			resolve(import.meta.dir, '_clone-hooks-')
		)
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
					hooks.transform(input, resolve(packageRoot, suffix))
				).toBe(omitted)
				expect(
					hooks.transform(
						input,
						resolve(packageRoot, 'node_modules/elysia', suffix)
					)
				).toBeUndefined()
			}

			// A later route's alias must retain the resolver on this same hook instance.
			process.env.ELYSIA_AOT_STATIC_CLONE_MODE = 'mixed'
			await hooks.buildStart()
			expect(hooks.transform(input, leaf)).toBeUndefined()

			process.env.ELYSIA_AOT_STATIC_CLONE_MODE = 'plain'
			await hooks.buildStart()
			expect(hooks.transform(input, leaf)).toBe(omitted)

			process.env.ELYSIA_AOT_STATIC_CLONE_MODE = 'throw'
			await expect(hooks.buildStart()).rejects.toThrow(
				'static clone rebuild boom'
			)

			process.env.ELYSIA_AOT_STATIC_CLONE_MODE = 'mixed'
			await hooks.buildStart()
			expect(hooks.transform(input, leaf)).toBeUndefined()
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
		it('vite transform still rewrites t when registerFrom is custom', () => {
			const plugin = viteAot('src/index.ts', {
				registerFrom: './elysia-wrapper'
			})

			const out = plugin.transform(
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
