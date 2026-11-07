import { afterAll, describe, expect, it } from 'bun:test'
import { Glob } from 'bun'
import { cp, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { createAotPluginHooks } from '../../src/plugin/aot/hooks'

/**
 * A wired build replaces the lazy `type/bridge` with a static
 * `export * from './bridge-live'`, which closes an import cycle through
 * `error.ts`. Bundlers scope-hoist the cycle away; a per-module evaluator
 * (Bun's `compile --aot`, plain `bun run` of the transformed tree) does not,
 * so a module-level read of a cycle binding in the wrong order throws a TDZ
 * ReferenceError at import. This evaluates the plugin-transformed `src/`
 * module by module in a subprocess, without bundling
 */

const REPO = resolve(import.meta.dir, '../..')
const FIXTURE = 'test/aot/fixtures/strip-hooks-app.ts'

let tmp: string | undefined

afterAll(async () => {
	if (tmp) await rm(tmp, { recursive: true, force: true })
})

describe('AOT transformed source, evaluated per module', () => {
	it('imports and serves an app with decorate, derive and beforeHandle', async () => {
		tmp = await mkdtemp(join(tmpdir(), 'elysia-module-order-'))
		// the plugin's source filters need a path segment named `elysia`
		const root = join(tmp, 'elysia')
		await mkdir(root)

		const hooks = createAotPluginHooks(resolve(REPO, FIXTURE), {
			target: 'bun'
		})
		await hooks.buildStart()

		// transform under the repo path (the plugin's Elysia root), write the
		// result into the copy, so every stub resolves relative to the copy
		const stubbed: string[] = []
		for await (const file of new Glob('src/**/*.ts').scan(REPO)) {
			const from = resolve(REPO, file)
			const code = await Bun.file(from).text()
			const out = hooks.isTransformCandidate(from)
				? hooks.transform(code, from, true)
				: undefined
			if (out !== undefined && out !== code) stubbed.push(file)
			await Bun.write(join(root, file), out ?? code)
		}

		// the cycle only exists when the bridge is wired statically
		expect(
			await Bun.file(join(root, 'src/type/bridge.ts')).text()
		).toContain(`export * from './bridge-live'`)
		expect(stubbed).toContain('src/type/bridge.ts')

		const entry = hooks.transform(
			await Bun.file(resolve(REPO, FIXTURE)).text(),
			resolve(REPO, FIXTURE),
			true
		)!
		expect(entry).toContain(`import 'elysia/compiled'`)
		await Bun.write(
			join(root, FIXTURE),
			entry.replace(`'elysia/compiled'`, `'../../../manifest.mjs'`)
		)
		await Bun.write(
			join(root, 'manifest.mjs'),
			hooks.load(hooks.resolveId('elysia/compiled')!)!
		)

		// the manifest imports `elysia`, `elysia/reconstruct`, ...: point the
		// package self-reference at the transformed copy. `version` feeds the
		// manifest ABI fingerprint
		await Bun.write(
			join(root, 'package.json'),
			JSON.stringify({
				name: 'elysia',
				version: (await Bun.file(join(REPO, 'package.json')).json())
					.version,
				type: 'module',
				exports: {
					'.': './src/index.ts',
					'./coerce-plan': './src/type/coerce-plan.ts',
					'./reconstruct': './src/compile/aot-reconstruct.ts',
					'./route-shape': './src/compile/handler/route-shape.ts'
				}
			})
		)
		await symlink(join(REPO, 'node_modules'), join(root, 'node_modules'))
		await cp(join(REPO, 'tsconfig.json'), join(root, 'tsconfig.json'))

		await Bun.write(
			join(root, 'run.ts'),
			`const { app } = await import('./${FIXTURE}')\n` +
				`const who = await (await app.handle(new Request('http://x/who'))).text()\n` +
				`const svc = await (await app.handle(new Request('http://x/svc'))).json()\n` +
				`console.log(JSON.stringify({ who, svc }))\n`
		)

		const proc = Bun.spawn(['bun', 'run.ts'], {
			cwd: root,
			stdout: 'pipe',
			stderr: 'pipe',
			env: { ...process.env, ELYSIA_AOT_BUILD: undefined }
		})
		const [stdout, stderr, code] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited
		])

		expect({ code, stderr }).toEqual({ code: 0, stderr: '' })
		expect(JSON.parse(stdout.trim())).toEqual({
			who: 'derived',
			svc: { n: 42 }
		})
	}, 15_000)
})
