import { describe, expect, it } from 'bun:test'

import { setupTypebox } from '../../src/type'
import * as bridge from '../../src/type/bridge'
import * as ops from '../../src/type/typebox-type'

describe('typebox-type', () => {
	/**
	 * `setupTypebox()` runs at import and snapshots `Ref` into the bridge, which
	 * is long before `typebox/type` is loaded — so the bridge holds the stub,
	 * not the real builder. The stub must therefore re-read its own module
	 * binding after loading; a stub that captured the value once would leave
	 * every bridge-routed `Ref` calling a stub forever.
	 */
	it('a binding captured before the lazy load still runs the real builder', () => {
		expect(bridge.Ref('#/components/schemas/user')).toMatchObject({
			$ref: '#/components/schemas/user'
		})
	})

	/**
	 * The whole deferral rests on `require('typebox/type')` resolving the same
	 * module instance a static import would (TypeBox is ESM-only, and
	 * `require(esm)` is unflagged on the runtimes we target). If it ever forked
	 * into a second copy, two `t.Date()` schemas would carry codecs from
	 * different module instances.
	 */
	it('loads the same module instance a static import resolves', async () => {
		// force the lazy load, then read the healed bindings
		ops.Null()

		const type = await import('typebox/type')

		expect(ops.Codec).toBe(type.Codec)
		expect(ops.Decode).toBe(type.Decode)
		expect(ops.Evaluate).toBe(type.Evaluate)
		expect(ops.Intersect).toBe(type.Intersect)
		expect(ops.Module).toBe(type.Module)
		expect(ops.Null).toBe(type.Null)
		expect(ops.Ref).toBe(type.Ref)
		expect(ops.Refine).toBe(type.Refine)
		expect(ops.Undefined).toBe(type.Undefined)
		expect(ops.Unsafe).toBe(type.Unsafe)
	})

	/**
	 * `typebox/type` is a SUBGRAPH of `typebox/value`, so the two leaves must
	 * keep independent latches: sharing one would make a single `t.Date()` drag
	 * the ~745 KB value graph in, which is the cost this whole split buys.
	 * `setupTypebox` therefore guards each side on its own field set — a
	 * type-only injection must leave every value binding exactly as it was.
	 */
	it('a type-side injection leaves the value ops untouched', async () => {
		const valueOps = await import('../../src/type/typebox-value')
		const type = await import('typebox/type')
		const system = await import('typebox/system')

		const Null = ((...args: Parameters<typeof type.Null>) =>
			type.Null(...args)) as typeof type.Null

		const Check = valueOps.Check
		const Compile = valueOps.Compile

		try {
			setupTypebox({ typebox: { type: { ...type, Null }, system } })

			expect(ops.Null).toBe(Null)
			expect(valueOps.Check).toBe(Check)
			expect(valueOps.Compile).toBe(Compile)
		} finally {
			ops.injectTypeboxType({ type, system })
		}
	})

	/**
	 * The injection hatch is the only way in for runtimes with no synchronous
	 * module loader (bundled workers), so it has to win over — and survive —
	 * the require path, and be safe to call on every `setupTypebox()`.
	 */
	it('setupTypebox({ typebox }) injects and is idempotent', async () => {
		const type = await import('typebox/type')
		const system = await import('typebox/system')

		const Unsafe = ((...args: Parameters<typeof type.Unsafe>) =>
			type.Unsafe(...args)) as typeof type.Unsafe

		try {
			setupTypebox({ typebox: { type: { ...type, Unsafe }, system } })
			expect(ops.Unsafe).toBe(Unsafe)

			setupTypebox({ typebox: { type, system } })
			expect(ops.Unsafe).toBe(type.Unsafe)

			setupTypebox({ typebox: { type, system } })
			expect(ops.Unsafe).toBe(type.Unsafe)
		} finally {
			ops.injectTypeboxType({ type, system })
		}
	})

	/**
	 * ops and ops-live must expose the identical surface wired to the same
	 * namespace — a wrong-namespace swap in ops-live (e.g. the value `Decode`
	 * exported where the type-level one belongs) would silently change
	 * AOT-bundle behavior, and only a bundled build would ever notice
	 */
	it('typebox-type-live mirrors every post-load binding', async () => {
		const live = await import('../../src/type/typebox-type-live')

		ops.injectTypeboxType({
			type: await import('typebox/type'),
			system: await import('typebox/system')
		})

		expect(Object.keys(live).sort()).toEqual(Object.keys(ops).sort())

		for (const key of Object.keys(live) as (keyof typeof live)[]) {
			if (
				key === 'injectTypeboxType' ||
				key === 'ensureTypeSettings' ||
				key === 'loadTypeNamespace'
			)
				continue

			expect(ops[key]).toBe(live[key])
		}

		// the accessor is the seam the `t` / `TypeSystem` proxies read, so both
		// modules must hand back the same two namespaces
		expect(live.loadTypeNamespace()).toEqual(ops.loadTypeNamespace())
	})
})
