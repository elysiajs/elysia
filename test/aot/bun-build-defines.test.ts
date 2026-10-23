import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import {
	appendFile,
	mkdtemp,
	mkdir,
	readFile,
	realpath,
	rm,
	symlink,
	writeFile
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { aot as sourceAot } from '../../src/plugin/aot/bun'

const PACKAGE = resolve(import.meta.dir, '../..')
const require = createRequire(import.meta.url)
let directory: string

beforeAll(async () => {
	directory = await mkdtemp(join(await realpath(tmpdir()), 'elysia-defines-'))
	await mkdir(join(directory, 'node_modules'))
	await symlink(PACKAGE, join(directory, 'node_modules/elysia'), 'dir')
})

afterAll(async () => {
	if (directory) await rm(directory, { recursive: true, force: true })
})

async function fixture(name: string, source = false, cjs = false) {
	const folder = join(directory, name)
	await mkdir(folder)
	const entry = join(folder, cjs ? 'app.cjs' : 'app.ts')
	const helper = cjs ? 'helper.cjs' : 'helper.ts'
	await writeFile(
		join(folder, helper),
		(cjs ? 'module.exports = ' : 'export const settings = ') +
			`{ version: BUILD_VERSION, feature: FEATURE_FLAG, environment: process.env.ELYSIA_AOT_DEFINE_TEST }\n`
	)
	const specifier = source ? resolve(PACKAGE, 'src/index.ts') : 'elysia'
	await writeFile(
		entry,
		(cjs
			? `const { Elysia, t } = require(${JSON.stringify(specifier)})\nconst settings = require('./${helper}')\n`
			: `import { Elysia, t } from ${JSON.stringify(specifier)}\nimport { settings } from './${helper}'\n`) +
			`if (THROW_CAPTURE) { require('node:fs').writeFileSync(${JSON.stringify(join(folder, 'failed.pid'))}, String(process.pid)); setInterval(() => {}, 1000); throw new Error('define capture fixture failed') }\n` +
			`const app = new Elysia().post('/' + settings.version, { body: settings.feature ? t.String() : t.Number() }, ({ body }) => settings.version + ':' + typeof body + ':' + settings.environment)\n` +
			(cjs ? 'module.exports = { app }\n' : 'export { app }\n')
	)
	return entry
}

function define(version: string, feature: boolean, fail = false) {
	return {
		BUILD_VERSION: JSON.stringify(version),
		FEATURE_FLAG: String(feature),
		THROW_CAPTURE: String(fail),
		'process.env.ELYSIA_AOT_DEFINE_TEST': JSON.stringify(
			'defined-' + version
		)
	}
}

async function build(
	entry: string,
	version: string,
	feature: boolean,
	{ source = false, cjs = false, fail = false } = {}
) {
	const aot = source
		? sourceAot
		: cjs
			? (require('elysia/plugin/aot/bun') as { aot: typeof sourceAot })
					.aot
			: (await import('elysia/plugin/aot/bun')).aot
	const output = join(directory, version)
	const result = await Bun.build({
		entrypoints: [entry],
		outdir: output,
		target: 'bun',
		format: cjs ? 'cjs' : 'esm',
		naming: 'app.js',
		define: define(version, feature, fail),
		plugins: [
			aot(entry, {
				target: 'bun',
				strip: true,
				...(source
					? {
							registerFrom: resolve(
								PACKAGE,
								'src/compile/aot.ts'
							),
							reconstructFrom: resolve(
								PACKAGE,
								'src/compile/aot-reconstruct.ts'
							),
							routeShapeFrom: resolve(
								PACKAGE,
								'src/compile/handler/route-shape.ts'
							)
						}
					: {})
			})
		]
	})
	expect(result.success, String(result.logs)).toBe(true)
	return join(output, 'app.js')
}

function verify(bundle: string, version: string, feature: boolean) {
	const result = spawnSync(
		process.execPath,
		[
			'--eval',
			`const mod = await import(${JSON.stringify(bundle)})
			const app = mod.app ?? mod.default.app
			for (const valid of [true, false]) {
				const body = valid === ${feature} ? 'hello' : 42
				const response = await app.handle(new Request('http://localhost/${version}', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
				if (response.status !== (valid ? 200 : 422)) throw new Error('unexpected status ' + response.status)
				if (valid && await response.text() !== '${version}:${feature ? 'string' : 'number'}:defined-${version}') throw new Error('unexpected body')
			}
			console.log('DEFINE_CAPTURE_OK')`
		],
		{ encoding: 'utf8', timeout: 30_000 }
	)
	expect(result.status, result.stderr).toBe(0)
	expect(result.stdout).toContain('DEFINE_CAPTURE_OK')
	expect(result.stderr).not.toContain('differs from the AOT build')
}

describe('Bun AOT build-time defines', () => {
	it.each([false, true])(
		'captures entry and imported module defines (source: %s)',
		async (source) => {
			const entry = await fixture('initial-' + source, source)
			const version = 'initial-' + source
			verify(await build(entry, version, true, { source }), version, true)
		}
	)

	it('isolates rebuilds of one entry with different defines', async () => {
		const entry = await fixture('rebuild')
		verify(await build(entry, 'first', true), 'first', true)
		verify(await build(entry, 'second', false), 'second', false)
	})

	it('isolates concurrent captures without changing parent globals or environment', async () => {
		const entry = await fixture('concurrent')
		const previousEnvironment = process.env.ELYSIA_AOT_DEFINE_TEST
		const previousGlobal = (globalThis as any).BUILD_VERSION
		const bundles = await Promise.all([
			build(entry, 'parallel-one', true),
			build(entry, 'parallel-two', false)
		])
		verify(bundles[0], 'parallel-one', true)
		verify(bundles[1], 'parallel-two', false)
		expect(process.env.ELYSIA_AOT_DEFINE_TEST).toBe(previousEnvironment)
		expect((globalThis as any).BUILD_VERSION).toBe(previousGlobal)
	})

	it('preserves capture error context and allows a later build', async () => {
		const entry = await fixture('failure')
		let failure: Error | undefined
		try {
			await build(entry, 'failed', true, { fail: true })
		} catch (error) {
			failure = error as Error
		}
		expect(failure?.message).toContain('define capture fixture failed')
		expect(failure?.stack).toContain(entry)
		const pid = Number(
			await readFile(join(directory, 'failure/failed.pid'), 'utf8')
		)
		expect(() => process.kill(pid, 0)).toThrow()
		verify(await build(entry, 'recovered', false), 'recovered', false)
	})

	it('reaps a successful capture even when app code handles SIGTERM', async () => {
		const entry = await fixture('persistent')
		const pidFile = join(directory, 'persistent/capture.pid')
		await appendFile(
			entry,
			`if (process.env.ELYSIA_AOT_BUILD) { require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000) }\n`
		)
		try {
			verify(await build(entry, 'persistent', true), 'persistent', true)
			const pid = Number(await readFile(pidFile, 'utf8'))
			expect(() => process.kill(pid, 0)).toThrow()
		} finally {
			try {
				process.kill(Number(await readFile(pidFile, 'utf8')), 'SIGKILL')
			} catch {}
		}
	})

	it.each([false, true])(
		'uses native JSX configuration (explicit tsconfig: %s)',
		async (explicit) => {
			const folder = join(directory, 'jsx-' + explicit)
			await mkdir(folder)
			await writeFile(
				join(folder, 'base.json'),
				JSON.stringify({
					compilerOptions: { jsx: 'react', jsxFactory: 'h' }
				})
			)
			await writeFile(
				join(folder, explicit ? 'custom.json' : 'tsconfig.json'),
				JSON.stringify({ extends: './base.json' })
			)
			const entry = join(folder, 'app.tsx')
			await writeFile(
				entry,
				`import { Elysia } from 'elysia'\nfunction h(_tag, _props, child) { return child }\nexport const app = new Elysia().get('/jsx', <value>{BUILD_VERSION}</value>)\n`
			)
			const { aot } = await import('elysia/plugin/aot/bun')
			const result = await Bun.build({
				entrypoints: [entry],
				outdir: join(folder, 'out'),
				target: 'bun',
				...(explicit ? { tsconfig: join(folder, 'custom.json') } : {}),
				define: { BUILD_VERSION: JSON.stringify('jsx-defined') },
				plugins: [aot(entry, { target: 'bun', strip: true })]
			})
			expect(result.success, String(result.logs)).toBe(true)
			const child = spawnSync(
				process.execPath,
				[
					'--eval',
					`const { app } = await import(${JSON.stringify(join(folder, 'out/app.js'))}); const response = await app.handle(new Request('http://localhost/jsx')); if (response.status !== 200 || await response.text() !== 'jsx-defined') throw new Error('JSX capture mismatch'); console.log('JSX_CAPTURE_OK')`
				],
				{ encoding: 'utf8', timeout: 30_000 }
			)
			expect(child.status, child.stderr).toBe(0)
			expect(child.stdout).toContain('JSX_CAPTURE_OK')
			expect(child.stderr).not.toContain('differs from the AOT build')
		}
	)

	it('preserves the CommonJS package condition', async () => {
		const entry = await fixture('commonjs', false, true)
		verify(
			await build(entry, 'commonjs', true, { cjs: true }),
			'commonjs',
			true
		)
	})
})
