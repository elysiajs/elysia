import { describe, it, expect } from 'bun:test'
import { resolve } from 'node:path'
import {
	IS_PRODUCTION_FILTER,
	TYPE_EXPORTS_FILTER,
	omitTypeboxSetup
} from '../../src/plugin/aot/core'
import { aot as viteAot } from '../../src/plugin/aot/vite'

const APP = resolve(import.meta.dir, 'fixtures/schema-bundle.ts')
const REGISTER_FROM = resolve(import.meta.dir, '../../src/compile/aot.ts')
const RECONSTRUCT_FROM = resolve(
	import.meta.dir,
	'../../src/compile/aot-reconstruct.ts'
)
const COERCE_PLAN_FROM = resolve(import.meta.dir, '../../src/type/coerce-plan.ts')
const BUN_AOT = resolve(import.meta.dir, '../../src/plugin/aot/bun.ts')
const buildBundle = async (
	options: Record<string, unknown> = {},
	minify = false
) => {
	const script = `
const { aot } = await import(${JSON.stringify(BUN_AOT)})
const result = await Bun.build({
	entrypoints: [${JSON.stringify(APP)}],
	plugins: [aot(${JSON.stringify(APP)}, {
		registerFrom: ${JSON.stringify(REGISTER_FROM)},
		reconstructFrom: ${JSON.stringify(RECONSTRUCT_FROM)},
		...${JSON.stringify(options)}
	}), {
		name: 'elysia-aot-test-source-subpaths',
		setup(build) {
			build.onResolve({ filter: /^elysia\\/coerce-plan$/ }, () => ({
				path: ${JSON.stringify(COERCE_PLAN_FROM)}
			}))
		}
	}],
	write: false,
	target: 'bun',
	minify: ${JSON.stringify(minify)}
})
if (!result.success) throw new Error(result.logs.map((log) => log.message).join('\\n'))
console.log(JSON.stringify(await result.outputs[0].text()))
`
	const subprocess = Bun.spawn({
		cmd: [process.execPath, '-e', script],
		stdout: 'pipe',
		stderr: 'pipe'
	})
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(subprocess.stdout).text(),
		new Response(subprocess.stderr).text(),
		subprocess.exited
	])
	if (exitCode !== 0) throw new Error(stderr || stdout)
	return JSON.parse(stdout) as string
}

describe('direct type entry', () => {
	it('matches only Elysia source and distribution type entries', () => {
		expect(TYPE_EXPORTS_FILTER.test('/x/elysia/src/type/exports.ts')).toBe(
			true
		)
		expect(
			TYPE_EXPORTS_FILTER.test(
				'/x/node_modules/elysia/dist/type/exports.mjs'
			)
		).toBe(true)
		expect(TYPE_EXPORTS_FILTER.test('/app/src/type/exports.ts')).toBe(false)
		expect(TYPE_EXPORTS_FILTER.test('/x/elysia/src/type/index.ts')).toBe(
			false
		)
	})

	it('omits setup from source and built ESM while retaining every export', () => {
		for (const source of [
			"import { setupTypebox } from './compat'\n\nsetupTypebox()\n\nexport const String = 1\n",
			'import { setupTypebox } from "./compat.mjs";\nexport * from "typebox/type"\nsetupTypebox();\nexport const String = 1;\n'
		]) {
			const transformed = omitTypeboxSetup(source)
			expect(transformed).not.toContain('setupTypebox')
			expect(transformed).toContain('String')
		}
	})

	it('omits setup from built CommonJS without changing other requires', () => {
		const transformed = omitTypeboxSetup(
			"const require_type_compat = require('./compat.js');\n" +
				"const type = require('typebox/type');\n" +
				'require_type_compat.setupTypebox();\n' +
				'exports.String = type.String;\n'
		)

		expect(transformed).not.toContain('require_type_compat')
		expect(transformed).toContain("require('typebox/type')")
		expect(transformed).toContain('exports.String')
	})

	it('fails if the public type entry shape drifts', () => {
		expect(() => omitTypeboxSetup('export const String = 1\n')).toThrow(
			'does not match the direct-image transform'
		)
	})

	it('omits setup from the direct type entry', async () => {
		const plugin = viteAot(APP, {
			registerFrom: REGISTER_FROM
		})
		await plugin.buildStart()

		const transformed = await plugin.transform(
			"import { setupTypebox } from './compat.mjs'\nsetupTypebox()\nexport const String = 1\n",
			'/x/node_modules/elysia/dist/type/exports.mjs'
		)

		expect(transformed).not.toContain('setupTypebox')
		expect(transformed).toContain('export const String = 1')
	})
})

describe('build-time production flag', () => {
	it('matches Elysia src and dist production modules', () => {
		expect(
			IS_PRODUCTION_FILTER.test(
				'/x/elysia/src/universal/is-production.ts'
			)
		).toBe(true)
		expect(
			IS_PRODUCTION_FILTER.test(
				'/x/node_modules/elysia/dist/universal/is-production.mjs'
			)
		).toBe(true)
		expect(
			IS_PRODUCTION_FILTER.test('/app/src/universal/is-production.ts')
		).toBe(false)
	})

	it('production builds remove runtime environment checks', async () => {
		const out = await buildBundle({}, true)

		expect(out).not.toContain('NODE_ENV')
	})

	it('development builds retain runtime environment checks', async () => {
		const out = await buildBundle({ production: false })

		expect(out).toContain('NODE_ENV')
		expect(out).not.toContain('IS_PRODUCTION = true')
	})
})
