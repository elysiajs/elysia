import { describe, it, expect } from 'bun:test'
import { Elysia, t } from '../../src'
import { autoHead } from '../../src/plugin/auto-head'

describe('loose path aliases', () => {
	it('preserves explicit slash and non-slash routes', async () => {
		const app = new Elysia()
			.get('/foo', () => 'real-foo')
			.get('/foo/', () => 'foo-slash')

		await expect((await app.handle('/foo')).text()).resolves.toBe(
			'real-foo'
		)
		await expect((await app.handle('/foo/')).text()).resolves.toBe(
			'foo-slash'
		)
	})

	it('preserves both routes regardless of registration order', async () => {
		const app = new Elysia()
			.get('/foo/', () => 'foo-slash')
			.get('/foo', () => 'real-foo')

		await expect((await app.handle('/foo')).text()).resolves.toBe(
			'real-foo'
		)
		await expect((await app.handle('/foo/')).text()).resolves.toBe(
			'foo-slash'
		)
	})

	it('still serves the loose twin when only one variant is declared', async () => {
		const app = new Elysia().get('/bar', () => 'bar')

		await expect((await app.handle('/bar/')).text()).resolves.toBe('bar')
	})
})

describe('JIT route aliases', () => {
	it('encoded-twin alias resolves consistently across repeated requests', async () => {
		const app = new Elysia().get('/café', () => 'coffee')

		await expect((await app.handle('/café')).text()).resolves.toBe('coffee')
		await expect(
			(await app.handle(encodeURI('/café'))).text()
		).resolves.toBe('coffee')
		await expect((await app.handle('/café')).text()).resolves.toBe('coffee')
	})

	it('auto-HEAD twin heals and returns headers-only', async () => {
		const app = new Elysia().use(autoHead()).get('/h', () => 'body-here')
		await app.modules

		await expect((await app.handle('/h')).text()).resolves.toBe('body-here')

		const head = await app.handle('/h', { method: 'HEAD' })
		expect(head.status).toBe(200)
		await expect(head.text()).resolves.toBe('')
	})

	it('loose alias of a trailing-slash route heals', async () => {
		const app = new Elysia().get('/dir/', () => 'dir')

		await expect((await app.handle('/dir/')).text()).resolves.toBe('dir')
		await expect((await app.handle('/dir')).text()).resolves.toBe('dir')
		await expect((await app.handle('/dir/')).text()).resolves.toBe('dir')
	})

	it('warmed aliases share the canonical compiled handler', async () => {
		const app = new Elysia().get('/dir/', () => 'dir')

		await app.handle('/dir/')
		await app.handle('/dir')

		const map = (app as any)['~map'].GET
		expect(map['/dir/']).toBe(map['/dir'])
		expect(typeof map['/dir']).toBe('function')
	})
})

describe('per-route hook composition', () => {
	it('shared-guard derive state does not bleed across two identical routes', async () => {
		let counter = 0

		const app = new Elysia()
			.guard({})
			.derive(() => ({ ticket: ++counter }))
			.get('/a', ({ ticket }: any) => ticket)
			.get('/b', ({ ticket }: any) => ticket)

		const a1 = await (await app.handle('/a')).text()
		const b1 = await (await app.handle('/b')).text()
		const a2 = await (await app.handle('/a')).text()

		expect(Number(a1)).toBeGreaterThan(0)
		expect(Number(b1)).toBe(Number(a1) + 1)
		expect(Number(a2)).toBe(Number(b1) + 1)
	})

	it('a route-local hook added to one route is not observed by its sibling', async () => {
		const marks: string[] = []

		const app = new Elysia()
			.guard({})
			.get(
				'/a',
				{
					beforeHandle: () => {
						marks.push('a-local')
					}
				},
				() => 'a'
			)
			.get('/b', () => 'b')

		await app.handle('/b')
		expect(marks).toEqual([])

		await app.handle('/a')
		expect(marks).toEqual(['a-local'])
	})
})

describe('model references', () => {
	it('unknown route-local ref throws at compile() with route + name', () => {
		const app = new Elysia().get('/', { query: 'Nope' as any }, () => 'ok')

		expect(() => app.compile()).toThrow(/Nope/)
		expect(() => app.compile()).toThrow(/GET \//)
	})

	it('respects .model() declared AFTER the route (does not false-positive)', () => {
		const app = new Elysia()
			.get('/', { query: 'Q' as any }, () => 'ok')
			.model({ Q: t.Object({ a: t.String() }) })

		expect(() => app.compile()).not.toThrow()
	})

	it('unknown response record ref throws with the status', () => {
		const app = new Elysia()
			.model({ Known: t.Number() })
			.get('/r', { response: { 200: 'Missing' as any } }, () => 1)

		expect(() => app.compile()).toThrow(/Missing/)
		expect(() => app.compile()).toThrow(/response 200/)
	})

	it('inline (non-ref) schemas never false-positive, incl. response record', () => {
		const app = new Elysia().get(
			'/ok',
			{
				query: t.Object({ q: t.String() }),
				response: { 200: t.Number() }
			},
			() => 1
		)

		expect(() => app.compile()).not.toThrow()
	})

	it('unknown guard-level ref throws during compilation', () => {
		const app = new Elysia()
			.guard({ query: 'GuardQ' as any })
			.get('/', () => 'x')

		expect(() => app.compile()).toThrow(/Unknown model reference "GuardQ"/)
		expect(() => app.compile()).toThrow(/GET \//)
	})

	it('unknown merge guard ref throws during compilation', () => {
		const app = new Elysia()
			.guard({ schema: 'merge', query: 'GuardGhost' as any })
			.get('/', () => 'x')

		expect(() => app.compile()).toThrow(
			/Unknown model reference "GuardGhost"/
		)
	})

	it('unknown macro-injected ref throws during compilation', () => {
		const app = new Elysia()
			.macro({ withSchema: () => ({ query: 'MacroGhost' as any }) })
			.get('/', { withSchema: true }, () => 'x')

		expect(() => app.compile()).toThrow(
			/Unknown model reference "MacroGhost"/
		)
	})

	it('unknown default response ref reports its status key', () => {
		const app = new Elysia().get(
			'/r',
			{ response: { default: 'BadRef' as any } },
			() => 'x'
		)

		expect(() => app.compile()).toThrow(/Unknown model reference "BadRef"/)
		expect(() => app.compile()).toThrow(/response default/)
	})

	it('accepts an inline response schema with a `default` property', () => {
		const app = new Elysia().get(
			'/inline',
			{ response: t.Object({ default: t.String() }) },
			() => ({ default: 'ok' })
		)

		expect(() => app.compile()).not.toThrow()
	})

	it('a failed lazy build stays loud and can recover without partial routes', async () => {
		const app = new Elysia()
			.get('/ok', () => 'ok')
			.get('/bad', { query: 'Missing' as any }, () => 'bad')

		expect(() => app.fetch).toThrow(/Missing/)
		expect(() => app.fetch).toThrow(/Missing/)
		await expect(app.handle('/ok')).rejects.toThrow(/Missing/)
		expect(() => app.compile()).toThrow(/Missing/)

		app.model({ Missing: t.Object({}) })
		expect(() => app.compile()).not.toThrow()
		await expect((await app.handle('/ok')).text()).resolves.toBe('ok')
		await expect((await app.handle('/bad')).text()).resolves.toBe('bad')
	})

	it('an eager compile failure cannot expose earlier partial routes', () => {
		const app = new Elysia()
			.get('/ok', () => 'ok')
			.get('/bad', { headers: { 'x-a': '1' } } as any, 'hello' as any)

		expect(() => app.compile()).toThrow(/Failed to compile route GET \/bad/)
		expect(() => app.fetch).toThrow(/Failed to compile route GET \/bad/)
	})
})

describe('model reference pre-scan', () => {
	it('finds a guard ref inherited by multiple routes', () => {
		const app = new Elysia()
			.guard({ query: 'ChainGhost' as any })
			.get('/a', () => 'x')
			.get('/b', () => 'y')

		expect(() => app.compile()).toThrow(
			/Unknown model reference "ChainGhost"/
		)
	})

	it('accepts an application without model references', () => {
		const app = new Elysia()
			.get('/a', () => 'x')
			.post(
				'/b',
				{
					body: t.Object({ a: t.String() }),
					response: { 200: t.String() }
				},
				({ body }) => body.a
			)

		expect(() => app.compile()).not.toThrow()
	})

	it('finds a ref behind later no-ref propagated hook nodes', () => {
		const app = new Elysia().guard({ query: 'OlderGhost' as any })

		for (let i = 0; i < 200; i++)
			app.beforeHandle(i % 2 ? 'plugin' : 'global', () => {})

		app.get('/older', () => 'x')

		expect(() => app.compile()).toThrow(
			/Unknown model reference "OlderGhost"/
		)
	})

	it('finds a ref on the combine side of an absorbed hook chain', () => {
		const child = new Elysia()
			.guard({ query: 'CombineGhost' as any })
			.get('/combine', () => 'x')

		const app = new Elysia().beforeHandle('plugin', () => {}).use(child)

		expect(() => app.compile()).toThrow(
			/Unknown model reference "CombineGhost"/
		)
	})

	it('finds a ref on the over side of an absorbed hook chain', () => {
		const child = new Elysia()
			.beforeHandle('plugin', () => {})
			.get('/over', () => 'x')

		const app = new Elysia().guard({ query: 'OverGhost' as any }).use(child)

		expect(() => app.compile()).toThrow(
			/Unknown model reference "OverGhost"/
		)
	})

	it('memoizes a deep no-ref propagated chain as false', () => {
		const app = new Elysia()

		for (let i = 0; i < 500; i++) app.beforeHandle('plugin', () => {})

		app.get('/deep', () => 'x')

		expect(() => app.compile()).not.toThrow()
	})
})

describe('route compilation errors', () => {
	it('eager compilation includes the route method and path', () => {
		const app = new Elysia().get(
			'/bad',
			{ headers: { 'x-a': '1' } } as any,
			'hello' as any
		)

		expect(() => app.compile()).toThrow(/Failed to compile route GET \/bad/)
	})

	it('lazy compilation includes the route in the error response', async () => {
		const app = new Elysia().get(
			'/bad',
			{ headers: { 'x-a': '1' } } as any,
			'hello' as any
		)

		const res = await app.handle(new Request('http://localhost/bad'))
		expect(res.status).toBe(500)

		const body = (await res.json()) as { detail?: string }
		expect(body.detail).toContain('Failed to compile route GET /bad')
	})
})
