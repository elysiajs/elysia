import { describe, expect, it } from 'bun:test'
import { resolve } from 'node:path'

import { Compiled, createAotFingerprint } from '../../src/compile/aot'
import { generateCompiledArtifacts } from '../../src/plugin/aot/core'
import type { AotTarget } from '../../src/plugin/aot/source'

const REGISTER_FROM = resolve(import.meta.dir, '../../src/compile/aot.ts')
const RECONSTRUCT_FROM = resolve(
	import.meta.dir,
	'../../src/compile/aot-reconstruct.ts'
)
const COERCE_PLAN_FROM = resolve(import.meta.dir, '../../src/type/coerce-plan.ts')
const WS_RUNTIME_FROM = resolve(import.meta.dir, '../../src/ws/runtime.ts')
const MOUNT_APP = resolve(
	import.meta.dir,
	'fixtures/direct-mount-app.ts'
)
const FORMS_APP = resolve(
	import.meta.dir,
	'fixtures/direct-app-plan-forms.ts'
)
const WS_APP = resolve(import.meta.dir, 'fixtures/direct-app-plan-ws.ts')
const STANDARD_WS_APP = resolve(
	import.meta.dir,
	'fixtures/direct-ws-standard.ts'
)
const MIXED_WS_APP = resolve(import.meta.dir, 'fixtures/direct-ws-mixed.ts')
const PRECOMPILED_APP = resolve(
	import.meta.dir,
	'fixtures/direct-precompiled-schema.ts'
)
const AOT_PLUGIN = resolve(import.meta.dir, '../../src/plugin/aot/bun.ts')

const buildAndRun = async (
	entry: string,
	paths: string[],
	target?: AotTarget,
	websocketPath?: string,
	minify = false
) => {
	const output = resolve(
		import.meta.dir,
		`_direct-app-plan.${Date.now()}.${Math.random().toString(36).slice(2)}.mjs`
	)
	const script = `
const { aot } = await import(${JSON.stringify(AOT_PLUGIN)})
const result = await Bun.build({
	entrypoints: [${JSON.stringify(entry)}],
	plugins: [aot(${JSON.stringify(entry)}, {
		registerFrom: ${JSON.stringify(REGISTER_FROM)},
		reconstructFrom: ${JSON.stringify(RECONSTRUCT_FROM)},
		wsRuntimeFrom: ${JSON.stringify(WS_RUNTIME_FROM)},
		target: ${JSON.stringify(target)}
	}), {
		name: 'elysia-aot-test-subpaths',
		setup(build) {
			build.onResolve({ filter: /^elysia\\/coerce-plan$/ }, () => ({
				path: ${JSON.stringify(COERCE_PLAN_FROM)}
			}))
		}
	}],
	target: 'bun',
	minify: ${JSON.stringify(minify)}
})
if (!result.success) throw new Error(result.logs.map((log) => log.message).join('\\n'))
const source = await result.outputs[0].text()
await Bun.write(${JSON.stringify(output)}, source)
process.env.ELYSIA_AOT_BUILD = '1'
try {
	const module = await import(${JSON.stringify(output)})
	const app = module.app ?? module.default
	const responses = []
	for (const path of ${JSON.stringify(paths)}) {
		const response = await app.handle(new Request('http://localhost' + path))
		responses.push({ status: response.status, body: await response.text() })
	}
	let websocket = false
	if (${JSON.stringify(websocketPath)}) {
		delete process.env.ELYSIA_AOT_BUILD
		app.listen(0)
		await new Promise((resolve, reject) => {
			const socket = new WebSocket('ws://localhost:' + app.server.port + ${JSON.stringify(websocketPath)})
			const timeout = setTimeout(() => reject(new Error('WebSocket close timed out')), 5000)
			socket.addEventListener('open', () => socket.close())
			socket.addEventListener('close', () => {
				clearTimeout(timeout)
				websocket = true
				resolve()
			})
			socket.addEventListener('error', reject)
		})
		await app.stop(true)
	}
	const legacyBundleSymbols = /handlerFactory|getHandler|Capture\.handler/.test(source)
	console.log(JSON.stringify({ responses, websocket, legacyBundleSymbols }))
} finally {
	await (await import('node:fs/promises')).rm(${JSON.stringify(output)}, { force: true })
}
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

	return JSON.parse(stdout) as {
		responses: Array<{
			status: number
			body: string
		}>
		websocket: boolean
		legacyBundleSymbols: boolean
	}
}

describe.serial('direct AppPlan artifact', () => {
	it('keeps deleted handler, stub, and virtual-type machinery out of source', async () => {
		const handlerJit = resolve(
			import.meta.dir,
			'../../src/compile/handler/jit.ts'
		)
		const files = [
			'../../src/compile/aot.ts',
			'../../src/compile/aot-emit.ts',
			'../../src/compile/aot-capture.ts',
			'../../src/compile/handler/index.ts',
			'../../src/plugin/aot/core.ts',
			'../../src/plugin/aot/hooks.ts',
			'../../src/plugin/aot/source.ts',
			'../../src/plugin/aot/rspack.ts'
		]
		const source = (
			await Promise.all(
				files.map((file) => Bun.file(resolve(import.meta.dir, file)).text())
			)
		).join('\n')

		expect(await Bun.file(handlerJit).exists()).toBe(false)
		expect(source).not.toMatch(
			/HandlerManifest|CapturedHandler|handlerFactory|getHandler\(|Capture\.handler|planFromReport|STUB_SOURCES|BridgeMode|StubPlan|generateVirtualType|OVERRIDE_MAP|\bstrip\??\s*:/
		)
	})

	it('emits one direct image without legacy handler or fallback surfaces', async () => {
		const artifacts = await generateCompiledArtifacts(FORMS_APP)

		expect(Object.keys(artifacts)).toEqual(['source'])
		expect(artifacts.source).toContain(
			'Compiled.register({ bf: 1, fingerprint, appPlan:'
		)
		expect(artifacts.source).not.toMatch(
			/export const handlers|\bhandlers\s*:|const _h\d+|handlerFactory|getHandler|planRebuilder|buildCoercedFromPlan/
		)
	})

	it('rejects a removed handler manifest before registration', () => {
		Compiled.clear()
		expect(() =>
			Compiled.register({
				bf: 1,
				fingerprint: createAotFingerprint(),
				handlers: {}
			} as any)
		).toThrow('[elysia-aot] legacy handler manifests were removed')
		expect(Compiled.pendingAppPlan()).toBeUndefined()
	})

	it('serves outer and mounted routes from the built artifact', async () => {
		const { responses } = await buildAndRun(MOUNT_APP, ['/', '/sub/hello'])

		expect(responses).toEqual([
			{ status: 200, body: 'outer' },
			{ status: 200, body: 'from-inner' }
		])
	})

	it('executes static, Promise, and Promise-lifecycle route forms', async () => {
		const { responses } = await buildAndRun(FORMS_APP, [
			'/static',
			'/promise',
			'/lifecycle'
		])

		expect(responses).toEqual([
			{ status: 201, body: 'static' },
			{ status: 200, body: 'promise' },
			{ status: 200, body: 'settled' }
		])
	})

	it('executes after identifier minification changes callback names', async () => {
		const { responses } = await buildAndRun(
			FORMS_APP,
			['/lifecycle'],
			undefined,
			undefined,
			true
		)

		expect(responses).toEqual([{ status: 200, body: 'settled' }])
	})

	it('executes a structural thenable in a workerd-targeted artifact', async () => {
		const { responses, legacyBundleSymbols } = await buildAndRun(
			FORMS_APP,
			[
				'/thenable',
				'/coerce?n=5',
				'/coerce?n=invalid',
				'/response-valid',
				'/response-invalid'
			],
			'workerd'
		)

		expect(responses.slice(0, 2)).toEqual([
			{ status: 200, body: 'thenable' },
			{ status: 200, body: '5' }
		])
		expect(responses[2]?.status).toBe(422)
		expect(responses[2]?.body).toContain('validation')
		expect(responses[3]).toEqual({
			status: 200,
			body: '{"ok":true}'
		})
		expect(responses[4]?.status).toBe(500)
		expect(responses[4]?.body).toContain('internal-server-error')
		expect(legacyBundleSymbols).toBe(false)
	})

	it('builds a direct WebSocket image that listens, connects, and closes', async () => {
		const { websocket, legacyBundleSymbols } = await buildAndRun(
			WS_APP,
			[],
			undefined,
			'/ws'
		)

		expect(websocket).toBe(true)
		expect(legacyBundleSymbols).toBe(false)
	})

	it('emits compact WS images only when no TypeBox sidecar can replace them', async () => {
		const standard = (await generateCompiledArtifacts(STANDARD_WS_APP)).source
		expect(standard).toContain('export const appPlanValidators = {}')
		expect(standard).toContain(
			'export const appPlanWSRoutes = {"/standard":_awr0,}'
		)
		expect((standard.match(/const _awr\d+/g) ?? []).length).toBe(1)

		const mixed = (await generateCompiledArtifacts(MIXED_WS_APP)).source
		expect(mixed).toContain('"WS":{"/typed"')
		expect(mixed).toContain(
			'export const appPlanWSRoutes = {"/plain":_awr0,}'
		)
		expect((mixed.match(/const _awr\d+/g) ?? []).length).toBe(1)
	})

	it('rejects precompiled schemas because their IR cannot be serialized', async () => {
		await expect(generateCompiledArtifacts(PRECOMPILED_APP)).rejects.toThrow(
			'build plugin cannot serialize a pre-compiled schema'
		)
	})
})
