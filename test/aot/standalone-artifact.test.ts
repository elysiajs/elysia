import { describe, expect, it } from 'bun:test'
import { resolve } from 'node:path'

import * as esbuild from 'esbuild'

const APP = resolve(import.meta.dir, 'fixtures/sealed-app.ts')
const AUTHORING_ONLY = [
	/(^|\/)plugin\/aot\//,
	/(^|\/)compile\/aot-capture\.(m?js|ts)$/,
	/(^|\/)compile\/aot-emit\.(m?js|ts)$/,
	/(^|\/)compile\/jit-probe\.(m?js|ts)$/,
	/(^|\/)sucrose\.(m?js|ts)$/
]
const HANDLER_JIT = /(^|\/)compile\/handler\/jit\.(m?js|ts)$/
const RUNTIME_AOT = /(^|\/)compile\/aot\.(m?js|ts)$/

describe('standalone AOT artifact', () => {
	it('omits AOT capture, emit, probe, and Sucrose modules while retaining the handler-JIT tripwire', async () => {
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
		const handlerJit = inputs.find(({ path }) => HANDLER_JIT.test(path))

		expect(authoring).toEqual([])
		// handler/index is the runtime dispatcher. Its JIT import is rewritten to
		// this small fail-loud tripwire, so the original input path remains.
		expect(handlerJit?.bytes).toBeLessThan(512)
		expect(result.outputFiles[0]!.text).toContain(
			'handler compiler JIT was stripped'
		)
		expect(result.outputFiles[0]!.text).not.toContain('new Function')
		expect(
			inputs.some(
				({ path, bytes }) => bytes > 0 && RUNTIME_AOT.test(path)
			)
		).toBe(true)
	})
})
