import { describe, it, expect } from 'bun:test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const DIST_CONTEXT = resolve(import.meta.dir, '../../dist/context.js')
const DIST_INDEX = resolve(import.meta.dir, '../../dist/index.js')
const DIST_RESUME = resolve(
	import.meta.dir,
	'../../dist/experimental/resume.js'
)

describe('Context own-field shape parity', () => {
	it('materializes request-owned response state only on first read', async () => {
		const srcCtx = await import('../../src/context.ts')
		const srcIdx = await import('../../src/index.ts')
		const app = new srcIdx.Elysia()
		const Context = srcCtx.createContext(app)
		const context = new Context(new Request('http://localhost/'))

		expect(Object.getOwnPropertyNames(context)).toEqual(['request'])
		expect(Object.hasOwn(context, 'set')).toBeFalse()

		const set = context.set
		expect(Object.hasOwn(context, 'set')).toBeTrue()
		expect(context.set).toBe(set)
		expect(Object.getPrototypeOf(set.headers)).toBeNull()
	})

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

	it('source and distribution handled routes preserve Context shape and identity', async () => {
		if (
			!existsSync(DIST_CONTEXT) ||
			!existsSync(DIST_INDEX) ||
			!existsSync(DIST_RESUME)
		)
			return

		const srcIdx = await import('../../src/index.ts')
		const srcResume = await import('../../src/experimental/resume.ts')
		const distIdx = await import(DIST_INDEX)
		const distResume = await import(DIST_RESUME)
		const observe = async (Elysia: any, resumeEmit: any) => {
			const contexts: any[] = []
			let fallbackWarnings = 0
			const originalWarn = console.warn
			console.warn = (...arguments_: unknown[]) => {
				if (arguments_.some((value) => String(value).includes('falls back')))
					fallbackWarnings++
				originalWarn(...arguments_)
			}
			try {
				const app = new Elysia({ experimental: { resumeEmit } }).get(
					'/',
					{
						transform(context: any) {
							contexts.push(context)
						},
						beforeHandle(context: any) {
							contexts.push(context)
						},
						afterHandle(context: any) {
							contexts.push(context)
						}
					},
					(context: any) => {
						contexts.push(context)
						return 'ok'
					}
				)
				const response = await app.handle(
					new Request('http://localhost/')
				)
				await response.text()
			} finally {
				console.warn = originalWarn
			}
			const first = contexts[0]
			return {
				callbacks: contexts.length,
				fallbackWarnings,
				identityMismatches: contexts.filter(
					(context) => context !== first
				).length,
				own: Object.getOwnPropertyNames(first).sort()
			}
		}

		const source = await observe(srcIdx.Elysia, srcResume.resumeEmit)
		const distribution = await observe(
			distIdx.Elysia,
			distResume.resumeEmit
		)
		expect(source.callbacks).toBe(4)
		expect(source.fallbackWarnings).toBe(0)
		expect(source.identityMismatches).toBe(0)
		expect(source).toEqual(distribution)
	})
})
