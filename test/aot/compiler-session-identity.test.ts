import '../../src/compile/aot-capture'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { Elysia, t } from '../../src'
import {
	abortCapture,
	Compiled,
	getCompilerSessionDiagnostics
} from '../../src/compile/aot'
import { captureArtifacts } from '../../src/plugin/aot/source'
import { Validator } from '../../src/validator'
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

describe('CompilerSession and app-local AOT identity', () => {
	it('claims once: different-schema and identical later apps compile fresh', async () => {
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

	it('rejects a manifest built by an incompatible framework abi', async () => {
		const { artifacts, validators, handlers } = await register()

		// re-register the same manifest with a bumped abi — a manifest built by
		// an incompatible framework/format version is rejected loudly
		Compiled.clear()
		Compiled.register({
			bf: 1,
			fingerprint: { ...artifacts.fingerprint, abi: 'from-the-future:99' },
			validators,
			handlers
		})

		expect(() => void buildA().fetch).toThrow('abi')
	})

	it('does not check route identity — binding is programId + abi only', async () => {
		// Route-level identity is intentionally not verified (a manifest is a
		// generated artifact from the app's own source and cannot realistically
		// diverge). A registered manifest binds by programId + abi; the accepted
		// tradeoff is one AOT-sealed app per process. This pins that a build
		// does NOT throw a route-table mismatch.
		await register() // manifest is for POST /x

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

	it('claims manifest routes while allowing a late route to use JIT', async () => {
		const { handlers } = await register()
		const original = handlers.POST!['/x']!.f
		let frozenFactoryCalls = 0
		handlers.POST!['/x']!.f = (...args: unknown[]) => {
			frozenFactoryCalls++
			return original(...args)
		}

		const app = buildA().get('/late', () => 'late')
		expect((await app.handle(post('/x', { a: 'ok' }))).status).toBe(200)
		expect(await (await app.handle(new Request('http://localhost/late'))).text()).toBe(
			'late'
		)
		expect(frozenFactoryCalls).toBe(1)
	})

	it('does not let a routeless app consume the registered manifest', async () => {
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

	it('does not mix a claimed program with global replay handlers', async () => {
		const stale = await captureArtifacts(
			new Elysia({ precompile: true }).get('/late', () => 'stale')
		)
		await register()
		Compiled.handlers = materialiseHandlers(stale.handlers)

		const app = buildA().get('/late', () => 'fresh')
		const response = await app.handle(
			new Request('http://localhost/late')
		)
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
