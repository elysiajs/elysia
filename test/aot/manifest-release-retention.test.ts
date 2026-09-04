import { describe, it, expect, afterEach, afterAll } from 'bun:test'
import { rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { Elysia, t } from '../../src'
import {
	Compiled,
	createAotFingerprint,
	type ProgramId
} from '../../src/compile/aot'
import { Validator } from '../../src/validator'
import { compileToSource } from '../../src/plugin/aot/source'

/**
 * plans/aot/002 — the register-mode manifest module must not pin its object
 * graph. WHY: the ES module is a process-lifetime GC root, so validators and
 * handlers hanging off top-level bindings (or exports) survive
 * `Compiled.release` forever — the whole graph has to live inside the
 * `Compiled.register(...)` argument, leaving the module owning nothing but
 * the fingerprint after registration.
 */

const ROUTES = 40
// In-repo `Compiled` source: resolves to the same module instance this test
// imports, so the generated module registers where the test can claim.
const REGISTER_FROM = resolve(import.meta.dir, '../../src/compile/aot.ts')
const RECONSTRUCT_FROM = resolve(
	import.meta.dir,
	'../../src/compile/aot-reconstruct.ts'
)

// Distinct plain schemas per route: no coercion/codec, so retention covers
// only the registered validator and handler graph.
const build = () => {
	const app = new Elysia()
	for (let i = 0; i < ROUTES; i++)
		app.post(
			`/r${i}`,
			{ body: t.Object({ [`k${i}`]: t.String() }) },
			({ body }: any) => body
		)
	return app
}

const manifest = (options?: { lazy?: number }) =>
	compileToSource(build() as any, {
		register: true,
		registerFrom: REGISTER_FROM,
		reconstructFrom: RECONSTRUCT_FROM,
		...options
	})

// Separate frame: keeps the claimed entry objects off the awaiting test
// function's stack so JSC's conservative scan cannot false-retain them.
const consumeAndRelease = (): WeakRef<object>[] => {
	const id = {} as ProgramId
	if (!Compiled.claim(id, createAotFingerprint()))
		throw new Error('claim failed: the imported module did not register')

	const refs: WeakRef<object>[] = []
	for (let i = 0; i < ROUTES; i++) {
		const entry = Compiled.getValidator('POST', `/r${i}`, 'body', id)
		if (!entry) throw new Error(`missing registered validator for /r${i}`)
		refs.push(new WeakRef(entry as object))
	}

	Compiled.release(id)
	return refs
}

const tempFiles: string[] = []

afterEach(() => {
	delete process.env.ELYSIA_AOT_BUILD
	Compiled.clear()
	Validator.clear()
})

afterAll(async () => {
	for (const file of tempFiles) await rm(file, { force: true })
})

describe('AOT manifest release retention (002)', () => {
	it('register mode exports nothing that pins the graph', async () => {
		const eager = await manifest()
		const lazy = await manifest({ lazy: 4 })
		delete process.env.ELYSIA_AOT_BUILD

		for (const src of [eager, lazy]) {
			expect(src).not.toContain('export const validators')
			expect(src).not.toContain('export const handlers')
			expect(src).not.toContain('export const groups')
			expect(src).not.toMatch(/^export default/m)
			// the graph is scoped inside the registration argument
			expect(src).toContain('Compiled.register((() => {')
			// the fingerprint stays exported (tiny, may have consumers)
			expect(src).toContain('export const fingerprint')
		}
	})

	it('release drops the last strong reference to registered validators', async () => {
		const src = await manifest()
		delete process.env.ELYSIA_AOT_BUILD

		Compiled.clear()

		// Evaluate as a REAL ES module: module-scope pinning is exactly what
		// is under test, so `new Function` evaluation would fake the premise.
		// Bun 1.3.14's test runner cannot dynamically import generated TS from /tmp.
		const file = resolve(
			import.meta.dir,
			`.elysia-002-retention-${process.pid}-${Date.now()}.ts`
		)
		tempFiles.push(file)
		await writeFile(file, src)
		await import(file)

		const refs = consumeAndRelease()

		const alive = () => refs.some((ref) => ref.deref() !== undefined)
		for (let i = 0; i < 10 && alive(); i++) {
			Bun.gc(true)
			await Bun.sleep(0)
		}

		// with the old top-level-const emit shape every entry stayed
		// reachable from the module here, keeping this permanently true
		expect(alive()).toBe(false)
	})
})
