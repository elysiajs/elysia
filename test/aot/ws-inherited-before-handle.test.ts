import { describe, it, expect, afterEach } from 'bun:test'
import type { Server } from 'bun'
import { resolve } from 'node:path'
import { rm } from 'node:fs/promises'

import type { Elysia } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import { aot as bunAot } from '../../src/plugin/aot/bun'

/**
 * An AOT build reconstructs its HTTP handlers but still builds WS routes at
 * runtime, outside the AOT build env, which is where the compact inherited
 * `beforeHandle` prefix applies. The inherited auth hook must hold on the
 * upgrade of the built app exactly as it does on its HTTP route.
 */

const REGISTER_FROM = resolve(import.meta.dir, '../../src/compile/aot.ts')
const ENTRY = 'test/aot/fixtures/ws-inherited-auth-app.ts'

const built: string[] = []

afterEach(async () => {
	Compiled.clear()
	Validator.clear()
	delete process.env.ELYSIA_AOT_BUILD
	for (const f of built.splice(0)) await rm(f, { force: true })
})

async function load() {
	const result = await Bun.build({
		entrypoints: [ENTRY],
		plugins: [
			bunAot(ENTRY, { registerFrom: REGISTER_FROM, strip: 'auto' })
		],
		target: 'bun'
	})
	if (!result.success)
		throw new Error(
			`build failed: ${result.logs.map((l) => l.message).join('\n')}`
		)

	const tmp = resolve(
		import.meta.dir,
		`_ws-auth-bundle.${Date.now()}.${Math.random().toString(36).slice(2)}.mjs`
	)
	built.push(tmp)
	const text = await result.outputs[0]!.text()
	await Bun.write(tmp, text)

	process.env.ELYSIA_AOT_BUILD = '1' // skip the bundle's app.listen on import
	try {
		return { text, app: (await import(tmp)).app as Elysia<any, any> }
	} finally {
		delete process.env.ELYSIA_AOT_BUILD
	}
}

const upgradeStatus = async (server: Server<any>, cookie?: string) =>
	(
		await fetch(`http://${server.hostname}:${server.port}/ws`, {
			headers: {
				upgrade: 'websocket',
				connection: 'Upgrade',
				'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
				'sec-websocket-version': '13',
				...(cookie ? { cookie } : {})
			}
		})
	).status

describe('AOT WebSocket inherited beforeHandle', () => {
	it('rejects an unauthenticated upgrade in the built app', async () => {
		const { text, app } = await load()

		// the HTTP route runs reconstructed, the WS route builder survives
		expect(text).toContain('handler compiler JIT was stripped')
		expect(text).not.toContain('WebSocket route builder was stripped')

		app.listen(0)

		try {
			const http = (await app.handle('/http')).status
			const denied = await upgradeStatus(app.server!)
			const allowed = await upgradeStatus(app.server!, 'session=ok')

			expect(http).toBe(401)
			expect(denied).toBe(http)
			expect(allowed).toBe(101)
		} finally {
			app.stop(true)
		}
	})
})
