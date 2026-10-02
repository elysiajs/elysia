import { describe, expect, it } from 'bun:test'
import { resolve } from 'node:path'

import * as typebox from 'typebox/type'

import { t } from '../../src/type'
import { OVERRIDE_MAP } from '../../src/plugin/aot/core'

const entry = resolve(import.meta.dir, '../../src/index.ts')

function run(script: string) {
	const proc = Bun.spawnSync({
		cmd: [process.execPath, '-e', script],
		cwd: resolve(import.meta.dir, '../..'),
		stdout: 'pipe',
		stderr: 'pipe'
	})

	if (proc.exitCode !== 0)
		throw new Error(
			`child exited ${proc.exitCode}\n${proc.stderr.toString()}`
		)

	return proc.stdout.toString().trim()
}

/**
 * `t` is a Proxy that materializes `typebox/type` lazily. It replaced a plain
 * `{ ...typeboxTypeNamespace, ...overrides }` object, and everything that reads
 * `t` as data — OpenAPI/schema generators walking it, `Object.keys`, spread,
 * `in` — has to keep seeing the object it used to be.
 */
describe('t namespace proxy', () => {
	const eager = { ...typebox, ...Object.fromEntries(
		Object.keys(OVERRIDE_MAP).map((name) => [name, (t as any)[name]])
	) }

	it('enumerates the same keys, in the same order, as the eager object', () => {
		expect(Object.keys(t)).toEqual(Object.keys(eager))
	})

	it('spreads to the same surface', () => {
		expect(Object.keys({ ...t })).toEqual(Object.keys(eager))

		for (const key of Object.keys(eager))
			expect(({ ...t } as any)[key]).toBe((eager as any)[key])
	})

	it("answers `in` for both TypeBox members and Elysia's overrides", () => {
		expect('Unsafe' in t).toBe(true)
		expect('ObjectString' in t).toBe(true)
		expect('DefinitelyNotATypeBoxMember' in t).toBe(false)
	})

	/**
	 * A getter that re-wrapped on every read would break every identity compare
	 * downstream (schema caches key on the constructor)
	 */
	it('returns a stable identity for a TypeBox member', () => {
		expect(t.Refine).toBe(t.Refine)
		expect(t.Refine).toBe(typebox.Refine)
	})

	/**
	 * The whole point: the modal schema is Elysia-owned builders only, so
	 * constructing it must not materialize `typebox/type` at all
	 */
	it('never loads typebox/type for the modal builders', () => {
		// If the modal builders had already pulled TypeBox in, the first touch
		// of a TypeBox-only member would cost ~nothing. The jump IS the proof
		const onFirstTypeBoxTouch = Number(
			run(
				`const { heapStats } = require('bun:jsc')\n` +
					`const { t } = await import(${JSON.stringify(entry)})\n` +
					`t.Object({ name: t.String() })\n` +
					`t.Number()\n` +
					`t.Boolean()\n` +
					`t.Integer()\n` +
					`Bun.gc(true)\n` +
					`const before = heapStats().heapSize\n` +
					`t.Unsafe({ type: 'string' })\n` +
					`Bun.gc(true)\n` +
					`console.log(heapStats().heapSize - before)`
			)
		)

		expect(onFirstTypeBoxTouch).toBeGreaterThan(500_000)
	})

	/**
	 * Accepted drift, pinned so it is a decision and not a surprise: freezing
	 * `t` used to work. The TypeBox-provided keys are not on the proxy target,
	 * so there is nothing there to make non-configurable.
	 *
	 * It must throw WITHOUT half-applying: a freeze that made the target
	 * non-extensible on the way out would leave every later `Object.keys(t)`
	 * throwing an invariant violation, process-wide
	 */
	it('throws on Object.freeze without corrupting itself', () => {
		expect(() => Object.freeze(t)).toThrow(TypeError)

		expect(Object.isExtensible(t)).toBe(true)
		expect(Object.keys(t)).toEqual(Object.keys(eager))
	})

	/**
	 * Regression: `Object.defineProperty(t, key, { get: ... })` lands directly
	 * on the proxy target with the JS-default attributes (non-enumerable,
	 * non-configurable). The old `ownKeys` trap used `Object.keys(target)`
	 * (enumerable-only), which omits a non-enumerable key — but the trap
	 * invariant requires every non-configurable own key to be reported
	 * regardless of enumerability, so that alone made every later
	 * `Object.keys(t)` throw a TypeError, permanently. The old
	 * `getOwnPropertyDescriptor` trap independently synthesized a
	 * `configurable: true` descriptor for ANY target-owned key, which for an
	 * enumerable-but-non-configurable key is incompatible with the target's
	 * real (non-configurable) descriptor and throws too.
	 *
	 * Runs in a child process: the probe keys are non-configurable, so the
	 * mutation is permanent for the whole process — in-process it would leak
	 * into every later test file that enumerates `t` (bun test shares one
	 * process across files).
	 */
	it('does not corrupt itself when properties are defined directly on the proxy', () => {
		const out = run(`
			const { t } = await import('./src/type/index.ts')

			Object.defineProperty(t, '__probeGetter', { get: () => 42 })
			Object.defineProperty(t, '__probeConst', {
				value: 'pinned',
				enumerable: true,
				writable: false,
				configurable: false
			})

			// must not throw — this is the bug: either trap violating its
			// invariant used to make this throw forever, for every caller of t
			const keys = Object.keys(t)

			if (!keys.includes('__probeConst'))
				throw new Error('enumerable non-configurable prop missing')
			if (keys.includes('__probeGetter'))
				throw new Error('non-enumerable prop leaked into Object.keys')

			// the target-owned descriptor is forwarded unchanged, not synthesized
			const getter = Object.getOwnPropertyDescriptor(t, '__probeGetter')
			if (
				getter.enumerable !== false ||
				getter.configurable !== false ||
				typeof getter.get !== 'function' ||
				t.__probeGetter !== 42
			)
				throw new Error('getter descriptor was synthesized')

			const constant = Object.getOwnPropertyDescriptor(t, '__probeConst')
			if (
				constant.value !== 'pinned' ||
				constant.enumerable !== true ||
				constant.writable !== false ||
				constant.configurable !== false
			)
				throw new Error('const descriptor was synthesized')

			// repeat enumeration stays healthy (the bug threw forever)
			Object.keys(t)
			console.log('OK ' + keys.length)
		`)

		expect(out).toBe(`OK ${Object.keys(eager).length + 1}`)
	})
})
