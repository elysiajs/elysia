import { describe, it, expect, afterEach } from 'bun:test'
import { resolve } from 'node:path'
import { rm } from 'node:fs/promises'

import { Elysia } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import { generateCompiledArtifacts } from '../../src/plugin/core'
import { aot as bunAot } from '../../src/plugin/bun'
import { post, req } from '../utils'

/**
 * Regression coverage for the three AOT `strip` modes.
 *
 * WHY this file exists (intent, not just behavior):
 *  - `strip:false` MUST be a no-op: a stripped-by-accident bundle would silently
 *    change runtime semantics, so we assert NO stub source ever leaks in.
 *  - `strip:'auto'` MUST be SOUND: it may only replace a module with a throwing
 *    stub when that module is provably unreachable. The dangerous failure is a
 *    FALSE POSITIVE (stub something the running app still needs) — so the tests
 *    here build a real bundle, run it, and assert correct responses, not just
 *    that a string is present/absent.
 *  - `strip:true` MUST fail loud at build time when handler JIT is still
 *    reachable (never ship a crashing bundle), and MUST still serve when the app
 *    is genuinely fully precompiled.
 *
 * Each scenario uses its own fixture file: AOT capture is non-idempotent per app
 * instance and the test runner shares the module cache, so reusing one entry
 * across builds would cross-contaminate captures.
 */

const REGISTER_FROM = resolve(import.meta.dir, '../../src/compile/index.ts')

/** Stub error markers the bundler injects per target (see `STUB_SOURCES`). */
const STUB_MARKERS = [
	'handler compiler JIT was stripped',
	'WebSocket route builder was stripped',
	'handler reconstruction was stripped'
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
		`_strip-regress.${Date.now()}.${Math.random().toString(36).slice(2)}.mjs`
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

describe('AOT strip regression — strip:false (must be a no-op)', () => {
	it('never injects any stub source, regardless of app shape', async () => {
		const text = await build(
			'test/aot/fixtures/regress-strip-false.ts',
			false
		)
		for (const marker of STUB_MARKERS) expect(text).not.toContain(marker)

		// real machinery must remain present, not stubbed
		expect(text).toContain('[Sucrose] warning')
	})

	it('the unstripped bundle still validates (200 valid / 422 invalid)', async () => {
		const text = await build(
			'test/aot/fixtures/regress-strip-false.ts',
			false
		)
		const app = await load(text)

		const ok = await app.handle(post('/u', { name: 'a', age: 1 }))
		expect(ok.status).toBe(200)
		await expect(ok.json()).resolves.toEqual({ name: 'a', age: 1 })

		const bad = await app.handle(post('/u', { name: 'a' }))
		expect(bad.status).toBe(422)
	})
})

describe('AOT strip regression — strip:true (fail loud or serve)', () => {
	it('throws at build time when handler JIT is still reachable (WS app)', async () => {
		await expect(
			build('test/aot/fixtures/regress-strip-true-ws.ts', true)
		).rejects.toThrow('AOT handler manifest')
	})

	it('success path: a fully precompiled app builds AND serves', async () => {
		const text = await build(
			'test/aot/fixtures/regress-strip-true.ts',
			true
		)

		// strip:true on a stubbable app must actually strip the heavy graph
		expect(text).toContain('handler compiler JIT was stripped')
		expect(text).not.toContain('[Sucrose] warning')

		const app = await load(text)
		const ok = await app.handle(post('/u', { name: 'a', age: 1 }))
		expect(ok.status).toBe(200)
		await expect(ok.json()).resolves.toEqual({ name: 'a', age: 1 })

		const bad = await app.handle(post('/u', { name: 'a' }))
		expect(bad.status).toBe(422)
	})
})

describe('AOT strip regression — strip:auto (sound: skip when unsafe)', () => {
	it('skips ALL stubbing for an app whose handler JIT stays reachable', async () => {
		const { stub } = await generateCompiledArtifacts(
			'test/aot/fixtures/regress-strip-auto-skip.ts',
			{ strip: 'auto' }
		)

		expect(stub).toEqual({
			jit: false,
			ws: false,
			reconstruct: false
		})

		const text = await build(
			'test/aot/fixtures/regress-strip-auto-skip.ts',
			'auto'
		)
		for (const marker of STUB_MARKERS) expect(text).not.toContain(marker)

		const app = await load(text)
		const ok = await app.handle(req('/'))
		expect(ok.status).toBe(200)
		await expect(ok.text()).resolves.toBe('ok')
	})

	it('SOUNDNESS: a cookie route keeps cookie reconstruction and still sets cookies', async () => {
		// Cookie inference surfaces the `cc` alias, so reconstructCookie must NOT
		// be stubbed. The real failure mode this guards: auto wrongly stubbing
		// cookie reconstruction, making the stripped bundle drop the set-cookie.
		const { stub } = await generateCompiledArtifacts(
			'test/aot/fixtures/regress-strip-cookie.ts',
			{ strip: 'auto' }
		)
		expect(stub.reconstruct).toBe(false)

		const text = await build(
			'test/aot/fixtures/regress-strip-cookie.ts',
			'auto'
		)
		expect(text).not.toContain('handler cookie reconstruction was stripped')

		const app = await load(text)
		const res = await app.handle(
			req('/change', { headers: { cookie: 'session=old' } })
		)
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('ok')
		expect(res.headers.getAll('set-cookie').length).toBeGreaterThan(0)
	})

	it('SOUNDNESS: userland sucrose imports are not replaced by handler-JIT strip', async () => {
		// The handler-JIT replay proves only that route compilation does not need
		// sucrose. It must not stub a public/source sucrose import used by app
		// code, or valid helpers like bracketPairRange become missing/throwing.
		const text = await build(
			'test/aot/fixtures/regress-strip-public-sucrose.ts',
			'auto'
		)
		expect(text).toContain('handler compiler JIT was stripped')

		const app = await load(text)
		const res = await app.handle(req('/range'))
		expect(res.status).toBe(200)
		await expect(res.text()).resolves.toBe('0,7')
	})

	it('SOUNDNESS: mount() disables stubbing so a lazy sub-app still serves (regression)', async () => {
		const { stub } = await generateCompiledArtifacts(
			'test/aot/fixtures/regress-strip-mount.ts',
			{ strip: 'auto' }
		)

		expect(stub).toEqual({
			jit: true,
			ws: true,
			reconstruct: true
		})

		const text = await build(
			'test/aot/fixtures/regress-strip-mount.ts',
			'auto'
		)

		const app = await load(text)
		const outer = await app.handle(req('/'))
		expect(outer.status).toBe(200)
		await expect(outer.text()).resolves.toBe('outer')

		const sub = await app.handle(req('/sub/hello'))
		expect(sub.status).toBe(200)
		await expect(sub.text()).resolves.toBe('from-inner')
	})
})
