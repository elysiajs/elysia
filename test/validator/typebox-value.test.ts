import { describe, expect, it } from 'bun:test'

import { t } from '../../src'
import { setupTypebox } from '../../src/type'
import * as bridge from '../../src/type/bridge'
import * as ops from '../../src/type/typebox-value'

describe('typebox-value', () => {
	/**
	 * `setupTypebox()` runs at import and snapshots the ops into the bridge,
	 * which is long before TypeBox is loaded — so the bridge holds the stubs,
	 * not the real ops. The stub must therefore re-read its own module binding
	 * after loading; a stub that captured the value once would leave every
	 * bridge-routed validation calling a stub forever.
	 */
	it('a binding captured before the lazy load still runs the real op', () => {
		expect(bridge.Check(t.String(), 'ok')).toBe(true)
		expect(bridge.Check(t.String(), 1)).toBe(false)
	})

	/**
	 * The whole deferral rests on `require('typebox/value')` resolving the same
	 * module instance a static import would (TypeBox is ESM-only, and
	 * `require(esm)` is unflagged on the runtimes we target). If it ever forked
	 * into a second copy, codec/registry state would silently split.
	 */
	it('loads the same module instance a static import resolves', async () => {
		// force the lazy load, then read the healed binding
		ops.Check(t.String(), 'ok')

		const value = await import('typebox/value')
		const schema = await import('typebox/schema')
		const compile = await import('typebox/compile')

		expect(ops.Check).toBe(value.Check)
		expect(ops.HasCodec).toBe(value.HasCodec)
		expect(ops.SchemaCompile).toBe(schema.Compile)
		expect(ops.Build).toBe(schema.Build)
		expect(ops.Compile).toBe(compile.Compile)
	})

	/**
	 * The injection hatch is the only way in for runtimes with no synchronous
	 * module loader (bundled workers), so it has to win over — and survive —
	 * the require path, and be safe to call on every `setupTypebox()`.
	 */
	it('setupTypebox({ typebox }) injects and is idempotent', async () => {
		const value = await import('typebox/value')
		const schema = await import('typebox/schema')
		const compile = await import('typebox/compile')

		const Check = ((...args: Parameters<typeof value.Check>) =>
			value.Check(...args)) as typeof value.Check

		try {
			setupTypebox({ typebox: { value: { ...value, Check }, schema, compile } })
			expect(ops.Check).toBe(Check)

			setupTypebox({ typebox: { value, schema, compile } })
			expect(ops.Check).toBe(value.Check)

			setupTypebox({ typebox: { value, schema, compile } })
			expect(ops.Check).toBe(value.Check)
		} finally {
			ops.injectTypebox({ value, schema, compile })
		}
	})

	/**
	 * A partial side used to be silently ignored: `{ value, schema }` without
	 * `compile` left every op on its stub with no signal, and `{ type }`
	 * without `system` never surfaced until an unrelated crash much later.
	 * Fail loud instead — each side is all-or-nothing.
	 */
	it('setupTypebox({ typebox }) throws on a partial side instead of silently ignoring it', async () => {
		const value = await import('typebox/value')
		const schema = await import('typebox/schema')
		const compile = await import('typebox/compile')
		const type = await import('typebox/type')
		const system = await import('typebox/system')

		expect(() => setupTypebox({ typebox: { value } })).toThrow()
		expect(() => setupTypebox({ typebox: { value, schema } })).toThrow()
		expect(() => setupTypebox({ typebox: { type } })).toThrow()
		expect(() => setupTypebox({ typebox: { system } })).toThrow()

		// complete sides must keep passing through untouched
		try {
			expect(() =>
				setupTypebox({ typebox: { value, schema, compile } })
			).not.toThrow()
			expect(() =>
				setupTypebox({ typebox: { type, system } })
			).not.toThrow()
		} finally {
			ops.injectTypebox({ value, schema, compile })
		}
	})

	/**
	 * ops and ops-live must expose the identical surface wired to the same
	 * namespaces — a wrong-namespace swap in ops-live (e.g. compile.Compile
	 * exported as SchemaCompile) would silently change AOT-bundle behavior
	 */
	it('typebox-value-live mirrors every post-load binding', async () => {
		const live = await import('../../src/type/typebox-value-live')

		ops.injectTypebox({
			value: await import('typebox/value'),
			schema: await import('typebox/schema'),
			compile: await import('typebox/compile')
		})

		expect(Object.keys(live).sort()).toEqual(Object.keys(ops).sort())

		for (const key of Object.keys(live) as (keyof typeof live)[]) {
			// The live module already loaded TypeBox, so its loaders are no-ops.
			if (key === 'injectTypebox' || key === 'warmTypebox') continue

			expect(ops[key]).toBe(live[key])
		}
	})

	it('typebox-value-live warmTypebox is inert', async () => {
		const live = await import('../../src/type/typebox-value-live')

		const before = live.HasCodec
		expect(live.warmTypebox()).toBeUndefined()
		expect(live.HasCodec).toBe(before)
	})
})
