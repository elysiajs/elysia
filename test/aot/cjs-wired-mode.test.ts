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
import { join, resolve } from 'node:path'

import * as esbuild from 'esbuild'

import { alignStubExtensions } from '../../src/plugin/aot/core'

const FIXTURE = resolve(import.meta.dir, 'fixtures/cjs-wired-aot-app.cjs')
const PACKAGE = resolve(import.meta.dir, '../..')

const { aot } = createRequire(import.meta.url)(
	'elysia/plugin/aot/esbuild'
) as typeof import('../../src/plugin/aot/esbuild')

let directory: string
let bundle: string

beforeAll(async () => {
	directory = mkdtempSync(join(tmpdir(), 'elysia-cjs-wired-'))
	const modules = join(directory, 'node_modules')
	const app = join(directory, 'app.cjs')

	mkdirSync(modules)
	symlinkSync(PACKAGE, join(modules, 'elysia'), 'dir')
	symlinkSync(
		resolve(PACKAGE, 'node_modules/typebox'),
		join(modules, 'typebox'),
		'dir'
	)
	copyFileSync(FIXTURE, app)
	bundle = join(directory, 'bundle.cjs')

	await esbuild.build({
		entryPoints: [app],
		bundle: true,
		outfile: bundle,
		format: 'cjs',
		platform: 'node',
		preserveSymlinks: true,
		logLevel: 'silent',
		plugins: [aot(app)]
	})
})

afterAll(() => {
	if (directory) rmSync(directory, { recursive: true, force: true })
})

/**
 * A wired CommonJS bundle re-routes `type/bridge` to `type/bridge-live`. The
 * CJS output copies re-exported bindings by value, and the require cycle
 * (validator -> error -> bridge -> bridge-live -> validator) used to copy
 * `TypeBoxValidator` before it existed, so every route answered 500
 */
describe('AOT CommonJS wired bundle', () => {
	it('keeps the TypeBox bridge wired', () => {
		expect(readFileSync(bundle, 'utf8')).toContain('class TypeBoxValidator')
	})

	it('serves frozen and bridge routes under Node.js', () => {
		const result = spawnSync('node', [bundle], {
			encoding: 'utf8',
			env: { ...process.env, ELYSIA_AOT_CJS_NODE_TEST: '1' },
			timeout: 30_000
		})

		expect(result.status, result.stderr).toBe(0)
		expect(result.stdout).toContain(
			'ELYSIA_AOT_CJS_WIRED_RESULTS=[200,200,422]'
		)
	}, 35_000)
})

// The CJS re-export stub is a Proxy whose `ownKeys` reports the target
// module's keys. Freezing it used to make the empty proxy target
// non-extensible first, which then breaks every invariant check after
describe('AOT CommonJS lazy re-export stub', () => {
	const load = () => {
		let loads = 0
		const live: Record<PropertyKey, unknown> = {
			Check: () => true,
			TypeBoxValidator: class {}
		}
		Object.defineProperty(live, Symbol.toStringTag, { value: 'Module' })

		const module = { exports: {} as any }
		new Function(
			'module',
			'exports',
			'require',
			alignStubExtensions(
				"export * from './bridge-live'\n",
				'/x/elysia/dist/type/bridge.js'
			)
		)(module, module.exports, (path: string) => {
			expect(path).toBe('./bridge-live.js')
			loads++

			return live
		})

		return { exports: module.exports, live, loads: () => loads }
	}

	it('loads the target on first use only', () => {
		const { exports, live, loads } = load()
		expect(loads()).toBe(0)

		expect(exports.TypeBoxValidator).toBe(live.TypeBoxValidator)
		expect(Object.keys(exports)).toEqual(['Check', 'TypeBoxValidator'])
		expect(loads()).toBe(1)
	})

	for (const lock of ['freeze', 'seal', 'preventExtensions'] as const)
		it(`survives Object.${lock}`, () => {
			const { exports, live } = load()

			expect(() => Object[lock](exports)).not.toThrow()
			expect(Object.isExtensible(exports)).toBe(false)
			expect(Object.keys(exports)).toEqual(['Check', 'TypeBoxValidator'])
			expect(exports.Check).toBe(live.Check)
			expect(Object.prototype.toString.call(exports)).toBe(
				'[object Module]'
			)
			if (lock === 'freeze') expect(Object.isFrozen(exports)).toBe(true)
		})
})
