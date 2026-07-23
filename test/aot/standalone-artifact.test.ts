import { describe, expect, it } from 'bun:test'
import { resolve } from 'node:path'

import * as esbuild from 'esbuild'

const APP = resolve(import.meta.dir, 'fixtures/sealed-app.ts')
const AUTHORING_ONLY = [
	/(^|\/)plugin\/aot\//,
	/(^|\/)compile\/aot-capture\.(m?js|ts)$/,
	/(^|\/)compile\/aot-emit\.(m?js|ts)$/
]
const DIRECT_PLANNER = [
	/(^|\/)compile\/jit-probe\.(m?js|ts)$/,
	/(^|\/)sucrose\.(m?js|ts)$/
]
const HANDLER_JIT = /(^|\/)compile\/handler\/jit\.(m?js|ts)$/
const RUNTIME_AOT = /(^|\/)compile\/aot\.(m?js|ts)$/

describe('standalone AOT artifact', () => {
	it('omits authoring modules and the deleted handler compiler', async () => {
		const { aot } = await import('elysia/plugin/aot/esbuild')
		const result = await esbuild.build({
			entryPoints: [APP],
			bundle: true,
			write: false,
			format: 'esm',
			platform: 'browser',
			target: 'esnext',
			conditions: ['workerd', 'worker', 'browser', 'import'],
			external: ['node:*'],
			metafile: true,
			minify: true,
			logLevel: 'silent',
			plugins: [aot(APP, { target: 'workerd' })]
		})
		const output = Object.values(result.metafile!.outputs).find(
			(candidate) => Object.keys(candidate.inputs).length > 0
		)
		expect(output).toBeDefined()

		const inputs = Object.entries(output!.inputs).map(
			([path, contribution]) => ({
				path: path.replace(/\\/g, '/'),
				bytes: contribution.bytesInOutput
			})
		)
		const authoring = inputs
			.filter(
				({ path, bytes }) =>
					bytes > 0 &&
					AUTHORING_ONLY.some((pattern) => pattern.test(path))
			)
			.map(({ path }) => path)
		expect(authoring).toEqual([])
		expect(inputs.some(({ path }) => HANDLER_JIT.test(path))).toBe(false)
		expect(result.outputFiles[0]!.text).not.toContain(
			'handler compiler JIT was stripped'
		)
		expect(result.outputFiles[0]!.text).not.toMatch(
			/handlerFactory|getHandler|Capture\.handler/
		)
		expect(result.outputFiles[0]!.text).not.toContain('new Function')
		expect(
			inputs.some(
				({ path, bytes }) => bytes > 0 && RUNTIME_AOT.test(path)
			)
		).toBe(true)
	})
})
