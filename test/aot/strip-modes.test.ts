import { describe, it, expect, afterEach } from 'bun:test'
import { resolve } from 'node:path'
import { rm } from 'node:fs/promises'

import { Elysia } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import { generateCompiledArtifacts } from '../../src/plugin/aot/core'
import { aot as bunAot } from '../../src/plugin/aot/bun'
import { json } from '../utils'

/**
 * `strip:false` keeps runtime compiler modules, `strip:true` removes them from
 * fully precompiled apps, and `strip:'auto'` removes only modules proven unused.
 * Fixtures stay isolated because AOT capture and the test module cache are shared.
 */

const REGISTER_FROM = resolve(import.meta.dir, '../../src/compile/aot.ts')

/** Error markers emitted by stripped runtime modules. */
const STUB_MARKERS = [
	'handler compiler JIT was stripped',
	'WebSocket route builder was stripped',
	'handler reconstruction was stripped',
	'cookie support was stripped'
] as const

const built: string[] = []

async function build(entry: string, strip: boolean | 'auto') {
	const result = await Bun.build({
		entrypoints: [entry],
		plugins: [bunAot(entry, { registerFrom: REGISTER_FROM, strip })],
		target: 'bun'
	})
	if (!result.success)
		throw new Error(
			`build failed: ${result.logs.map((l) => l.message).join('\n')}`
		)
	return await result.outputs[0]!.text()
}

/** Write a built bundle to disk and import it as a live, self-registering app. */
async function load(text: string) {
	const tmp = resolve(
		import.meta.dir,
		`_strip-bundle.${Date.now()}.${Math.random().toString(36).slice(2)}.mjs`
	)
	built.push(tmp)
	await Bun.write(tmp, text)

	const previous = process.env.ELYSIA_AOT_BUILD
	process.env.ELYSIA_AOT_BUILD = '1' // skip the bundle's app.listen on import
	try {
		const mod: any = await import(tmp)
		return (mod.app ?? mod.default) as Elysia<any, any>
	} finally {
		if (previous === undefined) delete process.env.ELYSIA_AOT_BUILD
		else process.env.ELYSIA_AOT_BUILD = previous
	}
}

afterEach(async () => {
	Compiled.clear()
	Validator.clear()
	delete process.env.ELYSIA_AOT_BUILD
	for (const f of built.splice(0)) await rm(f, { force: true })
})

describe('AOT strip disabled', () => {
	it('never injects any stub source, regardless of app shape', async () => {
		const text = await build(
			'test/aot/fixtures/strip-disabled-app.ts',
			false
		)
		for (const marker of STUB_MARKERS) expect(text).not.toContain(marker)

		// live sucrose code must be retained. `separateFunction` used to be the
		// marker, but it is imported ONLY by the trace subsystem, which is now
		// severed into `elysia/trace` — a traceless app no longer bundles it.
		// `sucrose` itself (parameter inference) is still core-live, so it is the
		// correct strip-disabled sucrose signal.
		expect(text).toContain('function sucrose')
	})

	it('the unstripped bundle still validates (200 valid / 422 invalid)', async () => {
		const text = await build(
			'test/aot/fixtures/strip-disabled-app.ts',
			false
		)
		const app = await load(text)

		const ok = await app.handle('/u', json({ name: 'a', age: 1 }))
		expect(ok.status).toBe(200)
		await expect(ok.json()).resolves.toEqual({ name: 'a', age: 1 })

		const bad = await app.handle('/u', json({ name: 'a' }))
		expect(bad.status).toBe(422)
	})
})

describe('forced AOT stripping', () => {
	it('strips the JIT graph for a WS-only app but retains the WS runtime', async () => {
		const text = await build(
			'test/aot/fixtures/strip-forced-ws-app.ts',
			true
		)
		expect(text).toContain('handler compiler JIT was stripped')
		expect(text).not.toContain('[Sucrose] warning')
		expect(text).not.toContain('WebSocket route builder was stripped')
		expect(text).toContain('class ElysiaWS')
	})

	it('builds and serves a fully precompiled app', async () => {
		const text = await build('test/aot/fixtures/strip-forced-app.ts', true)

		expect(text).toContain('handler compiler JIT was stripped')
		expect(text).not.toContain('[Sucrose] warning')

		const app = await load(text)
		const ok = await app.handle('/u', json({ name: 'a', age: 1 }))
		expect(ok.status).toBe(200)
		await expect(ok.json()).resolves.toEqual({ name: 'a', age: 1 })

		const bad = await app.handle('/u', json({ name: 'a' }))
		expect(bad.status).toBe(422)
	})
})

describe('automatic AOT stripping', () => {
	it('a WS route does not blanket-disable stubbing for the HTTP routes', async () => {
		const { stub } = await generateCompiledArtifacts(
			'test/aot/fixtures/strip-auto-ws-app.ts',
			{ strip: 'auto' }
		)

		expect(stub).toEqual({
			jit: true,
			ws: false,
			reconstruct: true,
			cookie: true,
			trace: true,
			sucrose: true,
			compat: true,
			bridge: false,
			typeboxValue: false,
			typeboxType: true,
			adapter: false,
			isProduction: true
		})

		const text = await build(
			'test/aot/fixtures/strip-auto-ws-app.ts',
			'auto'
		)
		expect(text).toContain('handler compiler JIT was stripped')
		expect(text).not.toContain('[Sucrose] warning')
		expect(text).not.toContain('WebSocket route builder was stripped')

		const app = await load(text)
		const ok = await app.handle('/')
		expect(ok.status).toBe(200)
		await expect(ok.text()).resolves.toBe('ok')
	})

	it('keeps cookie reconstruction when a route reads the cookie jar', async () => {
		const { stub } = await generateCompiledArtifacts(
			'test/aot/fixtures/strip-auto-cookie-app.ts',
			{ strip: 'auto' }
		)
		expect(stub.reconstruct).toBe(false)
		expect(stub.cookie).toBe(false)

		const text = await build(
			'test/aot/fixtures/strip-auto-cookie-app.ts',
			'auto'
		)
		expect(text).not.toContain('handler cookie reconstruction was stripped')
		expect(text).not.toContain('cookie support was stripped')

		const app = await load(text)
		const res = await app.handle('/change', {
			headers: { cookie: 'session=old' }
		})
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('ok')
		expect(res.headers.getAll('set-cookie').length).toBeGreaterThan(0)
	})

	it('tree-shakes JIT-only codegen helpers when handler JIT is stubbed', async () => {
		const text = await build(
			'test/aot/fixtures/strip-auto-jit-helpers-app.ts',
			'auto'
		)
		expect(text).toContain('handler compiler JIT was stripped')

		expect(text).not.toContain('mapTransform')
		expect(text).not.toContain('mapAfterResponse')
		expect(text).not.toContain('mapError')

		const app = await load(text)
		const res = await app.handle('/u', json({ name: 'a' }))
		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ name: 'a' })
	})

	it('strips request-side cookie machinery when no route reads cookies', async () => {
		const text = await build(
			'test/aot/fixtures/strip-auto-no-cookie-app.ts',
			'auto'
		)
		expect(text).toContain('cookie support was stripped')
		expect(text).not.toContain('importSecretKey')
		expect(text).not.toContain('crypto.subtle.importKey')

		const app = await load(text)
		const res = await app.handle('/echo', json({ name: 'a' }))
		expect(res.status).toBe(200)
		await expect(res.json()).resolves.toEqual({ name: 'a' })
	})

	it('keeps response cookie serialization after request cookie support is stripped', async () => {
		const text = await build(
			'test/aot/fixtures/strip-auto-set-cookie-app.ts',
			'auto'
		)
		expect(text).toContain('cookie support was stripped')

		const app = await load(text)
		const res = await app.handle('/manual')
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('ok')
		expect(res.headers.getAll('set-cookie')).toEqual(['token=abc'])
	})

	it('preserves userland sucrose imports when handler JIT is stripped', async () => {
		const text = await build(
			'test/aot/fixtures/strip-auto-sucrose-import-app.ts',
			'auto'
		)
		expect(text).toContain('handler compiler JIT was stripped')

		const app = await load(text)
		const res = await app.handle('/range')
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('0,7')
	})

	it('serves captured routes but rejects an uncaptured mounted sub-app', async () => {
		const { stub } = await generateCompiledArtifacts(
			'test/aot/fixtures/strip-auto-mount-app.ts',
			{ strip: 'auto' }
		)

		expect(stub).toEqual({
			jit: true,
			ws: true,
			reconstruct: true,
			cookie: true,
			trace: true,
			sucrose: true,
			compat: true,
			bridge: false,
			typeboxValue: false,
			typeboxType: true,
			adapter: false,
			isProduction: true
		})

		const text = await build(
			'test/aot/fixtures/strip-auto-mount-app.ts',
			'auto'
		)

		const app = await load(text)

		const outer = await app.handle('/')
		expect(outer.status).toBe(200)
		await expect(outer.text()).resolves.toBe('outer')

		const sub = await app.handle('/sub/hello')
		expect(sub.status).toBe(500)
	})
})
