import { afterEach, describe, expect, it } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { Elysia, t } from '../../src'
import { compileToSource } from '../../src/plugin/aot/source'
import { post } from '../utils'

const originalBunGc = Bun.gc
const originalBunServe = Bun.serve
const originalGlobalGc = globalThis.gc

afterEach(() => {
	Bun.gc = originalBunGc
	Bun.serve = originalBunServe
	globalThis.gc = originalGlobalGc
})

describe('no automatic GC', () => {
	it('construction, compilation, first request, and rebuild call no GC', async () => {
		let calls = 0
		Bun.gc = (() => calls++) as typeof Bun.gc
		globalThis.gc = () => calls++

		const app = new Elysia({ precompile: true }).post(
			'/x',
			{ body: t.Object({ value: t.String() }) },
			({ body }) => body
		)
		void app.fetch
		expect((await app.handle(post('/x', { value: 'ok' }))).status).toBe(200)
		app.compile()
		void app.fetch

		let reloads = 0
		Bun.serve = (() => ({
			reload: () => reloads++,
			stop: () => {}
		})) as typeof Bun.serve
		new Elysia().get('/reload', 'ok').listen(0)

		await Bun.sleep(0)
		expect(calls).toBe(0)
		expect(reloads).toBe(1)
	})

	it('generated release stubs contain no GC calls', async () => {
		const [source, plugin] = await Promise.all([
			compileToSource(
				new Elysia().get('/x', () => 'ok'),
				{
					register: true,
					registerFrom: '../../src/compile/aot'
				}
			),
			readFile(
				resolve(import.meta.dir, '../../src/plugin/aot/core.ts'),
				'utf8'
			)
		])

		expect(source).not.toContain('Bun.gc(')
		expect(source).not.toContain('global.gc(')
		expect(source).not.toContain('globalThis.gc(')
		expect(plugin).not.toContain('Bun.gc(')
		expect(plugin).not.toContain('global.gc(')
	})

	it('the Bun runtime adapter does not import the opt-in memory helper', async () => {
		const source = await readFile(
			resolve(import.meta.dir, '../../src/adapter/bun/index.ts'),
			'utf8'
		)

		expect(source).not.toMatch(/from ['"].*memory['"]/)
		expect(source).not.toContain('flushMemory(')
	})
})
