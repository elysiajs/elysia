/**
 * A19 — Context own-field shape parity between src and dist.
 *
 * Bun executes TypeScript source with ES2022 class-field semantics
 * (useDefineForClassFields=true): every class field declaration that lacks
 * `declare` becomes an own property even when never assigned.  The built
 * dist strips unassigned field declarations, leaving only constructor-
 * assigned slots.  This test pins that both forms produce identical shapes.
 */
import { describe, it, expect } from 'bun:test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const DIST_CONTEXT = resolve(import.meta.dir, '../../dist/context.js')
const DIST_INDEX = resolve(import.meta.dir, '../../dist/index.js')

describe('Context own-field shape parity (A19)', () => {
	it('src and dist Context construct identical own-field names', async () => {
		if (!existsSync(DIST_CONTEXT) || !existsSync(DIST_INDEX)) {
			console.log(
				'[A19] dist/ absent — skipping dist parity check (run `bun run build` first)'
			)
			// skip — don't fail on a cold checkout with no dist
			return
		}

		// src import — uses Bun's native TS transpiler
		const srcCtx = await import('../../src/context.ts')
		const srcIdx = await import('../../src/index.ts')

		// dist CJS import — the published artifact
		const distCtx = await import(DIST_CONTEXT)
		const distIdx = await import(DIST_INDEX)

		const srcApp = new srcIdx.Elysia()
		const distApp = new distIdx.Elysia()

		const SrcContext = srcCtx.createContext(srcApp)
		const DistContext = distCtx.createContext(distApp)

		const srcInst = new SrcContext(new Request('http://localhost/'))
		const distInst = new DistContext(new Request('http://localhost/'))

		const srcOwn = Object.getOwnPropertyNames(srcInst).sort()
		const distOwn = Object.getOwnPropertyNames(distInst).sort()

		expect(
			srcOwn,
			`src own fields [${srcOwn}] differ from dist own fields [${distOwn}]\n` +
				`Root cause: TypeScript class field declarations without 'declare' create\n` +
				`own-property slots in Bun (useDefineForClassFields=true) but not in the\n` +
				`built dist. Add 'declare' to type-only field declarations in buildEmptyContext().`
		).toEqual(distOwn)
	})

	it('both forms expose the same prototype-chain field names', async () => {
		if (!existsSync(DIST_CONTEXT) || !existsSync(DIST_INDEX)) {
			return
		}

		const srcCtx = await import('../../src/context.ts')
		const srcIdx = await import('../../src/index.ts')
		const distCtx = await import(DIST_CONTEXT)
		const distIdx = await import(DIST_INDEX)

		const srcApp = new srcIdx.Elysia()
		const distApp = new distIdx.Elysia()

		const SrcContext = srcCtx.createContext(srcApp)
		const DistContext = distCtx.createContext(distApp)

		const srcInst = new SrcContext(new Request('http://localhost/'))
		const distInst = new DistContext(new Request('http://localhost/'))

		// Walk the full prototype chain and collect all property names
		function allNames(obj: object): string[] {
			const names = new Set<string>()
			let proto: object | null = obj
			while (proto !== null) {
				for (const k of Object.getOwnPropertyNames(proto)) names.add(k)
				proto = Object.getPrototypeOf(proto)
			}
			return [...names].sort()
		}

		const srcAll = allNames(srcInst)
		const distAll = allNames(distInst)

		expect(srcAll).toEqual(distAll)
	})
})
