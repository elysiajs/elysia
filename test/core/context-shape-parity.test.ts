import { describe, it, expect } from 'bun:test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const DIST_CONTEXT = resolve(import.meta.dir, '../../dist/context.js')
const DIST_INDEX = resolve(import.meta.dir, '../../dist/index.js')

describe('Context own-field shape parity', () => {
	it('source and distribution builds expose the same own fields', async () => {
		if (!existsSync(DIST_CONTEXT) || !existsSync(DIST_INDEX)) {
			console.log(
				'dist/ absent — skipping Context parity check (run `bun run build` first)'
			)
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

	it('source and distribution builds expose the same inherited fields', async () => {
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
