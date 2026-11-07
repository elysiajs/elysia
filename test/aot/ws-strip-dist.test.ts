import { describe, it, expect, afterAll } from 'bun:test'
import { resolve, join } from 'node:path'
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

import * as esbuild from 'esbuild'

/**
 * A strip-mode WS app bundled from the published dist. dist resolves
 * `hasSyncHmac` from `cookie/crypto`, not `cookie/utils` as src does, so a
 * stubbed cookie module failed the bundle only from dist
 */

const APP = resolve(import.meta.dir, 'fixtures/strip-ws-dist-app.ts')
const TRACE_APP = resolve(
	import.meta.dir,
	'fixtures/strip-ws-trace-dist-app.ts'
)

const dir = mkdtempSync(join(tmpdir(), 'ely-ws-strip-dist-'))

afterAll(() => rmSync(dir, { recursive: true, force: true }))

const echoOf = (app: any) =>
	new Promise<string>((done, fail) => {
		const ws = new WebSocket(`ws://localhost:${app.server.port}/echo`)
		ws.onopen = () => ws.send('ping')
		ws.onmessage = (event) => {
			done(String(event.data))
			ws.close()
		}
		ws.onerror = () => fail(new Error('upgrade rejected'))
	})

async function buildFromDist(entry = APP): Promise<string> {
	const { aot } = await import('elysia/plugin/aot/esbuild')

	const previous = process.env.ELYSIA_AOT_BUILD
	process.env.ELYSIA_AOT_BUILD = '1'
	try {
		const result = await esbuild.build({
			entryPoints: [entry],
			bundle: true,
			write: false,
			format: 'esm',
			platform: 'neutral',
			external: ['node:*'],
			logLevel: 'silent',
			plugins: [aot(entry, { strip: 'auto' })]
		})
		return result.outputFiles[0]!.text
	} finally {
		if (previous === undefined) delete process.env.ELYSIA_AOT_BUILD
		else process.env.ELYSIA_AOT_BUILD = previous
	}
}

describe('strip-mode WebSocket app from dist', () => {
	it('bundles and upgrades', async () => {
		const code = await buildFromDist()
		// strip mode is on: the HTTP handler compiler is gone
		expect(code).toContain('handler compiler JIT was stripped')
		// no route uses cookies: the `cookie/crypto` stub must still export
		// `hasSyncHmac` for dist `ws/route`
		expect(code).toContain('cookie support was stripped')

		// a fresh dir per bundle: Bun's resolver caches a dir it already imported from
		const file = join(mkdtempSync(join(dir, 'b-')), 'bundle.mjs')
		writeFileSync(file, code)
		const { app } = await import(file)

		app.listen(0)
		try {
			const echo = await echoOf(app)
			expect(echo).toBe('ping')
		} finally {
			await app.stop(true)
		}
	})

	// no route links `tr`, but the fetch handler traces every request: the
	// trace stub threw at listen
	it('keeps trace for a WS-only traced app', async () => {
		const code = await buildFromDist(TRACE_APP)
		expect(code).toContain('handler compiler JIT was stripped')
		expect(code).not.toContain('trace support was stripped')

		const file = join(mkdtempSync(join(dir, 'b-')), 'bundle.mjs')
		writeFileSync(file, code)
		const { app, traced } = await import(file)

		const missing = await app.handle(new Request('http://e.ly/missing'))
		expect(missing.status).toBe(404)

		app.listen(0)
		try {
			const echo = await echoOf(app)
			expect(echo).toBe('ping')
			expect(traced).toEqual(['/missing', '/echo'])
		} finally {
			await app.stop(true)
		}
	})
})
