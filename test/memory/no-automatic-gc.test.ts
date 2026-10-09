import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { Elysia, t } from '../../src'
import { STUB_SOURCES } from '../../src/plugin/aot/core'
import { compileToSource } from '../../src/plugin/aot/source'
import { post, json } from '../utils'

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
		expect((await app.handle('/x', json({ value: 'ok' }))).status).toBe(200)
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
				{ registerFrom: '../../src/compile/aot' }
			),
			readFile(
				resolve(import.meta.dir, '../../src/plugin/aot/core.ts'),
				'utf8'
			)
		])

		expect(source).not.toContain('Bun.gc(')
		expect(source).not.toContain('global.gc(')
		expect(source).not.toContain('globalThis.gc(')

		// the only GC in the plugin is the explicit `flushMemory()` stub
		const memoryStub = STUB_SOURCES.sucrose[0]!.source
		expect(plugin.split('Bun.gc(').length).toBe(2)
		expect(plugin.split('globalThis.gc?.(').length).toBe(2)
		expect(plugin).not.toContain('global.gc(')
		expect(memoryStub).toContain('Bun.gc(')
		expect(memoryStub).toContain('globalThis.gc?.(')
		expect(memoryStub.match(/export function (\w+)/g)).toEqual([
			'export function flushMemory'
		])
	})

	// the stripped `flushMemory()` is the same explicit maintenance API as src/memory.ts
	for (const isBun of [true, false])
		it(`the stripped flushMemory() collects garbage (isBun: ${isBun})`, async () => {
			const dir = mkdtempSync(join(tmpdir(), 'ely-memory-stub-'))
			mkdirSync(join(dir, 'universal'))
			writeFileSync(
				join(dir, 'memory.ts'),
				STUB_SOURCES.sucrose[0]!.source
			)
			writeFileSync(
				join(dir, 'context.ts'),
				'export function clearContextCache() {}\n'
			)
			writeFileSync(
				join(dir, 'validator.ts'),
				'export const Validator = { clear() {} }\n'
			)
			writeFileSync(
				join(dir, 'universal/constants.ts'),
				`export const isBun = ${isBun}\n`
			)

			let bunCalls = 0
			let globalCalls = 0
			Bun.gc = (() => bunCalls++) as typeof Bun.gc
			globalThis.gc = () => globalCalls++

			try {
				const { flushMemory } = await import(join(dir, 'memory.ts'))
				flushMemory()
				expect([bunCalls, globalCalls]).toEqual(isBun ? [1, 0] : [0, 1])
			} finally {
				await rm(dir, { recursive: true, force: true })
			}
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
