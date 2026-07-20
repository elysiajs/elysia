import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import { compileToSource, autoGroupSize } from '../../src/plugin/aot/source'
import { claimManifest, registerManifest } from './_manifest'
import { post, req } from '../utils'

/** Lazy manifests build each validator group only when one of its routes is used. */

// Evaluate a side-effect-free manifest without materializing its groups.
const evalLazy = (src: string): any =>
	new Function(
		src
			.replace('export const groups', 'const groups')
			.replace('export const groupOf', 'const groupOf')
			.replace('export const handlers', 'const handlers') +
			'\nreturn { groups, groupOf, handlers }'
	)()

const build = () =>
	new Elysia()
		.post(
			'/body',
			{
				body: t.Object({ hello: t.String() })
			},
			({ body }) => body
		)
		.get(
			'/q',
			{
				query: t.Object({ id: t.Numeric() })
			},
			({ query }) => query
		)

afterEach(() => {
	delete process.env.ELYSIA_AOT_BUILD
	Compiled.clear()
	Validator.clear()
})

describe('lazy AOT validators', () => {
	it('emits route groups without an eager validator tree', async () => {
		const src = await compileToSource(build(), { register: false, lazy: 1 })
		delete process.env.ELYSIA_AOT_BUILD

		expect((src.match(/\(\) => \{/g) ?? []).length).toBe(2)
		expect(src).toContain('export const groups')
		expect(src).toContain('"/body":0')
		expect(src).not.toContain('export const validators')
	})

	it('materializes each group once on first access', async () => {
		const src = await compileToSource(build(), { register: false, lazy: 1 })
		delete process.env.ELYSIA_AOT_BUILD
		const { groups, groupOf, handlers } = evalLazy(src)

		const calls = [0, 0]
		const spied = groups.map((g: () => unknown, i: number) => () => {
			calls[i]++
			return g()
		})

		Validator.clear()
		const { '~programId': id } = claimManifest({
			lazyGroups: spied,
			lazyGroupOf: groupOf,
			handlers
		})

		expect(calls).toEqual([0, 0])

		expect(Compiled.getValidator('POST', '/body', 'body', id)).toBeDefined()
		expect(calls).toEqual([1, 0])

		Compiled.getValidator('POST', '/body', 'body', id)
		expect(calls).toEqual([1, 0])

		expect(Compiled.getValidator('GET', '/q', 'query', id)).toBeDefined()
		expect(calls).toEqual([1, 1])
	})

	it('reports registered validators without materializing their group', async () => {
		const src = await compileToSource(build(), { register: false, lazy: 1 })
		delete process.env.ELYSIA_AOT_BUILD
		const { groups, groupOf, handlers } = evalLazy(src)

		const calls = [0, 0]
		const spied = groups.map((g: () => unknown, i: number) => () => {
			calls[i]++
			return g()
		})
		Validator.clear()
		const { '~programId': id } = claimManifest({
			lazyGroups: spied,
			lazyGroupOf: groupOf,
			handlers
		})

		expect(Compiled.hasValidator('POST', '/body', 'body', id)).toBe(true)
		expect(calls).toEqual([0, 0])
		expect(Compiled.hasValidator('POST', '/nope', 'body', id)).toBe(false)
	})

	it('hoists schemas shared across groups', async () => {
		const body = t.Object({ hello: t.String() })
		const make = () =>
			new Elysia()
				.post('/a', { body }, ({ body }: any) => body)
				.post('/b', { body }, ({ body }: any) => body)
				.post('/c', { body }, ({ body }: any) => body)

		const src = await compileToSource(make() as any, {
			register: false,
			lazy: 1
		})
		delete process.env.ELYSIA_AOT_BUILD

		expect((src.match(/const _c\d+ =/g) ?? []).length).toBe(1)
		expect((src.match(/\(\) => \{/g) ?? []).length).toBe(3)
		expect(src.indexOf('const _c0')).toBeLessThan(src.indexOf('_groups'))

		const { groups, groupOf, handlers } = evalLazy(src)
		Validator.clear()
		registerManifest({
			lazyGroups: groups,
			lazyGroupOf: groupOf,
			handlers
		})
		const app = make()
		const ok = await app.handle(post('/b', { hello: 'world' }))
		expect(ok.status).toBe(200)
		await expect(ok.json()).resolves.toEqual({ hello: 'world' })
	})

	it('keeps route-specific schemas inside their groups', async () => {
		const app = new Elysia()
			.post(
				'/a',
				{
					body: t.Object({ a: t.String() })
				},
				({ body }: any) => body
			)
			.post(
				'/b',
				{
					body: t.Object({ b: t.String() })
				},
				({ body }: any) => body
			)

		const src = await compileToSource(app as any, {
			register: false,
			lazy: 1
		})
		delete process.env.ELYSIA_AOT_BUILD

		const firstThunk = src.indexOf('_groups')
		const topLevelEntries = (
			src.slice(0, firstThunk).match(/const _c\d+ =/g) ?? []
		).length
		expect(topLevelEntries).toBe(0)
	})

	it('emits no runtime code evaluation or dynamic imports', async () => {
		const app = new Elysia().post(
			'/x',
			{
				body: t.Object({ n: t.Numeric() })
			},
			({ body }: any) => body
		)
		const src = await compileToSource(app as any, {
			register: true,
			lazy: true
		})
		delete process.env.ELYSIA_AOT_BUILD

		expect(src).not.toMatch(/\bnew Function\b/)
		expect(src).not.toMatch(/\beval\s*\(/)
		expect(src).not.toMatch(/\bimport\s*\(/)
		expect(src).toContain('Compiled.register({ bf: 1, fingerprint')
	})

	it('preserves request validation and coercion', async () => {
		const src = await compileToSource(build(), {
			register: false,
			lazy: 64
		})
		delete process.env.ELYSIA_AOT_BUILD
		const { groups, groupOf, handlers } = evalLazy(src)

		Validator.clear()
		registerManifest({
			lazyGroups: groups,
			lazyGroupOf: groupOf,
			handlers
		})

		const app = build()
		const ok = await app.handle(post('/body', { hello: 'world' }))
		expect(ok.status).toBe(200)
		await expect(ok.json()).resolves.toEqual({ hello: 'world' })

		const bad = await app.handle(post('/body', { hello: 123 }))
		expect(bad.status).toBe(422)

		const q = await app.handle(req('/q?id=5'))
		await expect(q.json()).resolves.toEqual({ id: 5 })
	})
})

describe('lazy AOT group sizing', () => {
	it('defaults to eager validators so large manifests add no lazy thunks', async () => {
		const body = t.Object({ value: t.String() })
		const app = new Elysia()
		for (let i = 0; i < 516; i++)
			app.post(`/r${i}`, { body }, ({ body }: any) => body)

		const source = await compileToSource(app as any, {
			register: false
		})
		expect(source).toContain('export const validators')
		expect(source).not.toContain('export const groups')
		expect(source).not.toContain('const _groups')
	})

	it('scales the group size by route count', () => {
		expect(autoGroupSize(1)).toBe(1)
		expect(autoGroupSize(63)).toBe(1)
		expect(autoGroupSize(64)).toBe(2)
		expect(autoGroupSize(255)).toBe(2)
		expect(autoGroupSize(256)).toBe(4)
		expect(autoGroupSize(2047)).toBe(4)
		expect(autoGroupSize(2048)).toBe(16)
		expect(autoGroupSize(8191)).toBe(16)
		expect(autoGroupSize(8192)).toBe(64)
	})

	it('auto-scales group count unless an explicit size is provided', async () => {
		const make = (n: number) => {
			const app = new Elysia()
			for (let i = 0; i < n; i++)
				app.post(
					`/r${i}`,
					{
						body: t.Object({ [`k${i}`]: t.String() })
					},
					({ body }: any) => body
				)
			return app
		}

		const auto = await compileToSource(make(100) as any, {
			register: false,
			lazy: true
		})
		delete process.env.ELYSIA_AOT_BUILD
		expect((auto.match(/\(\) => \{/g) ?? []).length).toBe(
			Math.ceil(100 / autoGroupSize(100))
		)

		const fixedSize = await compileToSource(make(100) as any, {
			register: false,
			lazy: 25
		})
		delete process.env.ELYSIA_AOT_BUILD
		expect((fixedSize.match(/\(\) => \{/g) ?? []).length).toBe(
			Math.ceil(100 / 25)
		)
	})
})
