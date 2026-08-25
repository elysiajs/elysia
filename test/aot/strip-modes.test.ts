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
			exactMirror: false,
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

	// The cookie stub gate keys on the `cc` alias, which only the HTTP JIT
	// emits. A WS route's cookie schema is enforced in the upgrade path
	// instead, so keying on `cc` alone stubbed `parseCookieRaw` /
	// `buildCookieJar` / `compileCookieConfig` out from under it and turned
	// every upgrade on that route into a 500.
	it('keeps cookie support when only a WS route declares a cookie schema', async () => {
		const { stub } = await generateCompiledArtifacts(
			'test/aot/fixtures/strip-auto-ws-cookie-app.ts',
			{ strip: 'auto' }
		)

		expect(stub.jit).toBe(true)
		expect(stub.cookie).toBe(false)

		const text = await build(
			'test/aot/fixtures/strip-auto-ws-cookie-app.ts',
			'auto'
		)
		expect(text).toContain('handler compiler JIT was stripped')
		expect(text).not.toContain('cookie support was stripped')

		const app = await load(text)

		// no server is listening under `handle()`, so a *passing* upgrade
		// stops at the "requires a running server" 500 — what matters is that
		// the cookie channel ran for real in both directions
		const missing = await app.handle('/ws', {
			headers: { upgrade: 'websocket' }
		})
		expect(missing.status).toBe(422)

		const present = await app.handle('/ws', {
			headers: { upgrade: 'websocket', cookie: 'token=abc' }
		})
		// asserting the *absence* of the stub marker is too weak: a 500 for
		// any other reason would also pass. Assert the real success path
		// instead — a valid cookie clears validation and reaches the actual
		// "no running server" upgrade error, not the stub's throw
		expect(present.status).toBe(500)
		await expect(present.text()).resolves.toContain(
			'WebSocket upgrade requires a running server'
		)
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

	// A mounted sub-app is a second Elysia with its own router build. The
	// manifest is one flat method+path table bound to whichever app builds
	// first, so `.mount()` is unrepresentable rather than merely mis-ordered:
	// `sub.fetch` makes the sub-app steal the parent's frozen validators,
	// `sub.handle` leaves the mounted routes with no frozen entry at all.
	// Refusing the build is the only outcome that is neither a 500 in
	// production nor a silent validation bypass.
	it('refuses to build an app that mounts a sub-app', async () => {
		await expect(
			generateCompiledArtifacts(
				'test/aot/fixtures/strip-auto-mount-app.ts',
				{ strip: 'auto' }
			)
		).rejects.toThrow('mounts a sub-app')

		// the refusal is a property of manifest binding, not of stripping
		await expect(
			generateCompiledArtifacts(
				'test/aot/fixtures/strip-auto-mount-app.ts',
				{ strip: false }
			)
		).rejects.toThrow('mounts a sub-app')

		// and it fails the bundler build, not just the low-level API
		await expect(
			build('test/aot/fixtures/strip-auto-mount-app.ts', 'auto')
		).rejects.toThrow('mounts a sub-app')
	})
})
