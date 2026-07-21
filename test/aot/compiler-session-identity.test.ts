import '../../src/compile/aot-capture'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { Elysia, t } from '../../src'
import { Compiled } from '../../src/compile/aot'
import {
	abortCapture,
	getCompilerSessionDiagnostics
} from '../../src/compile/aot-capture'
import { captureArtifacts } from '../../src/plugin/aot/source'
import { Validator } from '../../src/validator'
import { buildFrozenWSRoute } from '../../src/ws/runtime'
import { post } from '../utils'
import { materialise, materialiseHandlers } from './_manifest'

const buildA = () =>
	new Elysia({ precompile: true }).post(
		'/x',
		{ body: t.Object({ a: t.String() }) },
		({ body }) => body
	)

const register = async () => {
	const artifacts = await captureArtifacts(buildA())
	const validators = materialise(artifacts.validators)
	const handlers = materialiseHandlers(artifacts.handlers)

	Compiled.clear()
	Compiled.register({
		bf: 1,
		fingerprint: artifacts.fingerprint,
		validators,
		handlers
	})

	return { artifacts, validators, handlers }
}

beforeEach(() => {
	abortCapture()
	Compiled.clear()
	Validator.clear()
})

afterEach(() => {
	abortCapture()
	Compiled.clear()
	Validator.clear()
})

describe('AOT manifest ownership and compiler sessions', () => {
	it('only the first compatible app consumes a registered manifest', async () => {
		const { handlers } = await register()
		const original = handlers.POST!['/x']!.f
		let frozenFactoryCalls = 0
		handlers.POST!['/x']!.f = (...args: unknown[]) => {
			frozenFactoryCalls++
			return original(...args)
		}

		const appA = buildA()
		const a = await appA.handle(post('/x', { a: 'ok' }))
		expect(a.status).toBe(200)
		expect(frozenFactoryCalls).toBe(1)

		const appB = new Elysia({ precompile: true }).post(
			'/x',
			{ body: t.Object({ b: t.Number() }) },
			({ body }) => body
		)
		expect((await appB.handle(post('/x', { b: 1 }))).status).toBe(200)
		expect((await appB.handle(post('/x', { a: 'wrong' }))).status).toBe(422)

		const appC = buildA()
		const c = await appC.handle(post('/x', { a: 'ok' }))
		expect(c.status).toBe(a.status)
		expect(await c.text()).toBe(await a.text())
		expect(frozenFactoryCalls).toBe(1)
	})

	it('rejects a manifest built by an incompatible framework ABI', async () => {
		const { artifacts, validators, handlers } = await register()

		Compiled.clear()
		Compiled.register({
			bf: 1,
			fingerprint: {
				...artifacts.fingerprint,
				abi: 'from-the-future:99'
			},
			validators,
			handlers
		})

		expect(() => void buildA().fetch).toThrow('abi')
	})

	it('binds by program ID and ABI without comparing route tables', async () => {
		await register()

		const other = new Elysia({ precompile: true }).get(
			'/other',
			() => 'other'
		)
		expect(() => void other.fetch).not.toThrow()
		expect(
			await (
				await other.handle(new Request('http://localhost/other'))
			).text()
		).toBe('other')
	})

	it('hydrates matching WS images and falls back on mismatches', async () => {
		const captured = await captureArtifacts(
			new Elysia({ precompile: true }).ws('/ws', {
				message: () => {}
			})
		)
		const route = captured.wsRoutes.find(
			(entry) => entry.path === '/ws' && 'source' in entry
		)
		if (!route || !('source' in route))
			throw new Error('expected a captured WS image')
		const factory = new Function(
			'buildFrozenWSRoute',
			`return ${route.source}`
		)(buildFrozenWSRoute) as (...args: unknown[]) => unknown

		let matchingHydrated = false
		Compiled.register({
			bf: 1,
			fingerprint: captured.fingerprint,
			wsRoutes: {
				'/ws': {
					a: route.roles,
					f: (...args) => {
						const result = factory(...args)
						matchingHydrated = result !== undefined
						return result
					}
				}
			}
		})
		void new Elysia({ precompile: true }).ws('/ws', {
			message: () => {}
		}).fetch
		expect(matchingHydrated).toBe(true)

		let roleFactoryCalls = 0
		Compiled.register({
			bf: 1,
			fingerprint: captured.fingerprint,
			wsRoutes: {
				'/ws': {
					a: ['open'],
					f: (...args) => {
						roleFactoryCalls++
						return factory(...args)
					}
				}
			}
		})
		void new Elysia({ precompile: true }).ws('/ws', {
			message: () => {}
		}).fetch
		expect(roleFactoryCalls).toBe(0)

		let semanticFactoryCalls = 0
		let hydrated = true
		Compiled.register({
			bf: 1,
			fingerprint: captured.fingerprint,
			wsRoutes: {
				'/ws': {
					a: route.roles,
					f: (...args) => {
						semanticFactoryCalls++
						const result = factory(...args)
						hydrated = result !== undefined
						return result
					}
				}
			}
		})
		void new Elysia({ precompile: true }).ws('/ws', {
			async message(ws) {
				ws.send('different semantics')
			}
		}).fetch
		expect(semanticFactoryCalls).toBe(1)
		expect(hydrated).toBe(false)
	})

	it('uses the manifest for captured routes and JIT for later routes', async () => {
		const { handlers } = await register()
		const original = handlers.POST!['/x']!.f
		let frozenFactoryCalls = 0
		handlers.POST!['/x']!.f = (...args: unknown[]) => {
			frozenFactoryCalls++
			return original(...args)
		}

		const app = buildA().get('/late', () => 'late')
		expect((await app.handle(post('/x', { a: 'ok' }))).status).toBe(200)
		expect(
			await (
				await app.handle(new Request('http://localhost/late'))
			).text()
		).toBe('late')
		expect(frozenFactoryCalls).toBe(1)
	})

	it('leaves a registered manifest available after compiling a routeless app', async () => {
		const { handlers } = await register()
		const original = handlers.POST!['/x']!.f
		let frozenFactoryCalls = 0
		handlers.POST!['/x']!.f = (...args: unknown[]) => {
			frozenFactoryCalls++
			return original(...args)
		}

		void new Elysia({ precompile: true }).fetch

		const response = await buildA().handle(post('/x', { a: 'ok' }))
		expect(response.status).toBe(200)
		expect(frozenFactoryCalls).toBe(1)
	})

	it('ignores a stale registration after an app claims its manifest', async () => {
		const stale = await captureArtifacts(
			new Elysia({ precompile: true }).get('/late', () => 'stale')
		)
		await register()

		const app = buildA().get('/late', () => 'fresh')
		expect((await app.handle(post('/x', { a: 'ok' }))).status).toBe(200)

		// a registration arriving after the claim must never rebind the app
		Compiled.register({
			bf: 1,
			fingerprint: stale.fingerprint,
			handlers: materialiseHandlers(stale.handlers)
		})

		const response = await app.handle(new Request('http://localhost/late'))
		expect(await response.text()).toBe('fresh')
	})

	it('releases sessions after successful and failed builds', () => {
		const good = new Elysia({ precompile: true }).get('/ok', () => 'ok')
		void good.fetch
		expect(good['~compilerSession']).toBeUndefined()
		expect(getCompilerSessionDiagnostics()).toEqual({
			active: false,
			appAttached: false,
			validators: 0,
			handlers: 0,
			wsRoutes: 0,
			sucrose: 0
		})

		const bad = new Elysia({ precompile: true }).post(
			'/bad',
			{ body: 'missing' as any },
			() => 'bad'
		)
		expect(() => void bad.fetch).toThrow('Unknown model reference')
		expect(bad['~compilerSession']).toBeUndefined()
		expect(getCompilerSessionDiagnostics().active).toBe(false)
	})
})
