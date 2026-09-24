import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'

import * as esbuild from 'esbuild'

const FIXTURE = resolve(import.meta.dir, 'fixtures/cjs-dist-aot-app.cjs')
const MIXED_FIXTURE = resolve(
	import.meta.dir,
	'fixtures/cjs-mixed-edge-aot-app.cjs'
)
const ESM_FIXTURE = resolve(import.meta.dir, 'fixtures/dist-dedup-app.ts')
const PACKAGE = resolve(import.meta.dir, '../..')

const requirePublic = createRequire(import.meta.url)
const { aot } = requirePublic(
	'elysia/plugin/aot/esbuild'
) as typeof import('../../src/plugin/aot/esbuild')

const findNode = () => {
	const executable = process.platform === 'win32' ? 'node.exe' : 'node'
	const candidates = new Set(
		(process.env.PATH ?? '')
			.split(delimiter)
			.filter(Boolean)
			.map((directory) => join(directory, executable))
	)

	for (const candidate of candidates) {
		const probe = spawnSync(
			candidate,
			[
				'-e',
				"process.exit(process.release.name === 'node' && typeof Request === 'function' ? 0 : 1)"
			],
			{ stdio: 'ignore' }
		)

		if (probe.status === 0) return candidate
	}

	throw new Error('Node.js with the Fetch API is required for this test')
}

const isElysiaDistInput = (input: string) => {
	const path = input.replace(/\\/g, '/')

	return /(^|\/)node_modules\/elysia\/dist\/.*\.(m?js)$/.test(path)
}

const isTypeBoxInput = (input: string) => {
	const path = input.replace(/\\/g, '/')

	return /(^|\/)node_modules\/typebox\/.*\.(m?js)$/.test(path)
}

let directory: string
let bundle: string
let graphInputs: string[]
let retainedInputs: string[]
let typeboxGraphInputs: string[]
let typeboxRetainedInputs: string[]
let code: string

beforeAll(async () => {
	directory = mkdtempSync(join(tmpdir(), 'elysia-cjs-aot-'))
	const modules = join(directory, 'node_modules')
	const installed = join(modules, 'elysia')
	const app = join(directory, 'app.cjs')

	mkdirSync(modules)
	symlinkSync(
		PACKAGE,
		installed,
		process.platform === 'win32' ? 'junction' : 'dir'
	)
	symlinkSync(
		resolve(PACKAGE, 'node_modules/typebox'),
		join(modules, 'typebox'),
		process.platform === 'win32' ? 'junction' : 'dir'
	)
	copyFileSync(FIXTURE, app)
	bundle = join(directory, 'bundle.cjs')

	const result = await esbuild.build({
		entryPoints: [app],
		bundle: true,
		outfile: bundle,
		format: 'cjs',
		platform: 'node',
		preserveSymlinks: true,
		metafile: true,
		logLevel: 'silent',
		plugins: [aot(app)]
	})

	graphInputs = Object.keys(result.metafile!.inputs).filter(isElysiaDistInput)
	typeboxGraphInputs = Object.keys(result.metafile!.inputs).filter(
		isTypeBoxInput
	)
	const output = Object.entries(result.metafile!.outputs).find(
		([path]) => !path.endsWith('.map')
	)!
	retainedInputs = Object.keys(output[1].inputs).filter(isElysiaDistInput)
	typeboxRetainedInputs = Object.keys(output[1].inputs).filter(isTypeBoxInput)
	code = readFileSync(bundle, 'utf8')
})

afterAll(() => {
	if (directory) rmSync(directory, { recursive: true, force: true })
})

describe('AOT CommonJS package identity', () => {
	it('bundles only the CommonJS Elysia runtime graph', () => {
		expect(graphInputs.some((path) => path.endsWith('.js'))).toBe(true)
		expect(graphInputs.filter((path) => path.endsWith('.mjs'))).toEqual([])
		expect(retainedInputs.filter((path) => path.endsWith('.mjs'))).toEqual(
			[]
		)
		// TypeBox publishes one ESM-only condition (`import` and `default` both
		// point at `.mjs`); prove generated imports do not create a second copy.
		expect(typeboxGraphInputs.some((path) => path.endsWith('.mjs'))).toBe(
			true
		)
		expect(
			typeboxGraphInputs.filter((path) => path.endsWith('.js'))
		).toEqual([])
		expect(
			typeboxRetainedInputs.filter((path) => path.endsWith('.js'))
		).toEqual([])
		expect(code).toContain('Compiled.register(')
		expect(code).toContain('handler compiler JIT was stripped')
	})

	it('serves its first and second request under Node.js', () => {
		const result = spawnSync(findNode(), [bundle], {
			encoding: 'utf8',
			env: {
				...process.env,
				ELYSIA_AOT_CJS_NODE_TEST: '1'
			},
			timeout: 30_000
		})

		expect(result.error).toBeUndefined()
		expect(result.status, result.stderr).toBe(0)
		expect(result.stdout).toContain(
			'ELYSIA_AOT_CJS_NODE_RESULTS=[[200,"first:1"],[200,"second:2"]]'
		)
		expect(result.stdout).toContain(
			'ELYSIA_AOT_CJS_FORMAT_RESULTS=[[200,"valid@example.com"],'
		)
		expect(result.stdout).toContain('],[422,')
	}, 35_000)

	it('fails loud when the entry graph mixes Elysia edge conditions', async () => {
		await expect(
			esbuild.build({
				entryPoints: [MIXED_FIXTURE],
				bundle: true,
				write: false,
				format: 'cjs',
				platform: 'node',
				preserveSymlinks: true,
				logLevel: 'silent',
				plugins: [aot(MIXED_FIXTURE)]
			})
		).rejects.toThrow('conflicts with the "cjs" entry module condition')
	})

	it('fails loud when custom conditions override the CommonJS edge', async () => {
		await expect(
			esbuild.build({
				entryPoints: [FIXTURE],
				bundle: true,
				write: false,
				format: 'cjs',
				platform: 'node',
				conditions: ['import'],
				logLevel: 'silent',
				plugins: [aot(FIXTURE)]
			})
		).rejects.toThrow("conditions includes 'import' for a CommonJS entry")
	})

	it('fails loud when custom conditions select declaration files', async () => {
		for (const fixture of [FIXTURE, ESM_FIXTURE])
			await expect(
				esbuild.build({
					entryPoints: [fixture],
					bundle: true,
					write: false,
					platform: 'node',
					conditions: ['types'],
					logLevel: 'silent',
					plugins: [aot(fixture)]
				})
			).rejects.toThrow("conditions includes 'types'")
	})

	it('fails loud when the plugin and entry use opposite package conditions', async () => {
		const run = (source: string) =>
			spawnSync(process.execPath, ['-e', source], {
				cwd: PACKAGE,
				encoding: 'utf8',
				timeout: 30_000
			})

		const importPlugin = run(`
			import * as esbuild from 'esbuild'
			const { aot } = await import('elysia/plugin/aot/esbuild')
			const entry = ${JSON.stringify(FIXTURE)}
			try {
				await esbuild.build({ entryPoints: [entry], bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent', plugins: [aot(entry)] })
			} catch (error) {
				const message = error?.message ?? String(error)
				if (message.includes('entry uses the CommonJS "require" package condition, but the AOT build plugin was loaded through ESM "import"')) process.exit(0)
				console.error(message)
				process.exit(2)
			}
			process.exit(1)
		`)
		expect(importPlugin.status, importPlugin.stderr).toBe(0)

		const requirePlugin = run(`
			import * as esbuild from 'esbuild'
			import { createRequire } from 'node:module'
			const { aot } = createRequire(import.meta.url)('elysia/plugin/aot/esbuild')
			const entry = ${JSON.stringify(ESM_FIXTURE)}
			try {
				await esbuild.build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'neutral', external: ['node:*'], logLevel: 'silent', plugins: [aot(entry)] })
			} catch (error) {
				const message = error?.message ?? String(error)
				if (message.includes('entry uses the ESM "import" package condition, but the AOT build plugin was loaded through CommonJS "require"')) process.exit(0)
				console.error(message)
				process.exit(2)
			}
			process.exit(1)
		`)
		expect(requirePlugin.status, requirePlugin.stderr).toBe(0)
	})
})
