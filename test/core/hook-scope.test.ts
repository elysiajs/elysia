import { describe, expect, it } from 'bun:test'
import { resolve } from 'node:path'
import { Elysia } from '../../src'

// An unrecognised scope used to register the hook as local, so a plugin's
// 1.x-style `'scoped'` auth hook silently stopped guarding the routes of the
// app that used it
describe('hook scope', () => {
	for (const scope of ['scoped', 'Global', { as: 'bogus' }])
		it(`rejects ${JSON.stringify(scope)}`, () => {
			expect(() =>
				new Elysia().onBeforeHandle(scope as any, () => {})
			).toThrow('[Elysia] Invalid hook scope')

			expect(() => new Elysia().derive(scope as any, () => ({}))).toThrow(
				'[Elysia] Invalid hook scope'
			)
		})

	// hook methods accept the 1.x `{ as }` object (below), guard does not
	for (const scope of [
		{ as: 'scoped' },
		{ as: 'global' },
		'scoped',
		'Global'
	])
		it(`guard rejects ${JSON.stringify(scope)}`, () => {
			// the object form hits guard's own 1.x migration error first
			expect(() =>
				new Elysia().guard(scope as any, { beforeHandle() {} })
			).toThrow(/Invalid hook scope|was removed in 2\.0/)
		})

	it('accepts every 2.0 scope', async () => {
		const plugin = new Elysia()
			.onBeforeHandle('plugin', ({ set }) => {
				set.headers['x-plugin'] = '1'
			})
			.onBeforeHandle('global', ({ set }) => {
				set.headers['x-global'] = '1'
			})
			.onBeforeHandle('local', () => {})

		const app = new Elysia().use(plugin).get('/', () => 'ok')
		const res = await app.handle(new Request('http://localhost/'))

		expect(res.headers.get('x-plugin')).toBe('1')
		expect(res.headers.get('x-global')).toBe('1')
	})

	// `.as()` used to lift every hook into the parent whatever the target, so
	// a 1.x `.as('scoped')`, an `.as('local')` or a typo failed open
	it('rejects an unknown .as() scope', () => {
		for (const scope of ['scoped', 'local', 'Global', undefined])
			expect(() =>
				new Elysia().onBeforeHandle(() => {}).as(scope as any)
			).toThrow('[Elysia] Invalid .as() scope')

		expect(() => new Elysia().as('scoped' as any)).toThrow(
			"1.x 'scoped' is 'plugin'"
		)
	})

	// 1.x `schema: 'standalone'` silently fell back to the override channel,
	// so a guard's own validation stopped running under routes with a schema
	it('rejects an unknown guard schema mode', () => {
		for (const schema of ['standalone', 'Merge'])
			expect(() =>
				new Elysia().guard({ schema: schema as any }, (app) => app)
			).toThrow('[Elysia] Invalid guard schema')

		expect(() =>
			new Elysia().guard({ schema: 'merge' }, (app) => app)
		).not.toThrow()
		expect(() =>
			new Elysia().guard({ schema: 'override' }, (app) => app)
		).not.toThrow()
	})
})

// 1.x plugins still pass `{ as: 'scoped' | 'global' | 'local' }`. Read as
// local, a `'scoped'` auth hook would stop guarding the app that uses the
// plugin, so the object must map to the same scope as the 2.0 argument
describe('1.x { as } hook options', () => {
	const header = (as: 'local' | 'scoped' | 'global') =>
		new Elysia().onBeforeHandle({ as }, ({ set }) => {
			set.headers['x-hook'] = '1'
		})

	const derived = (as: 'local' | 'scoped' | 'global') =>
		new Elysia().derive({ as }, () => ({ who: 'plugin' }))

	// plugin -> parent -> grandparent, each with its own route
	const tree = (plugin: Elysia<any, any, any, any, any, any, any, any>) =>
		new Elysia()
			.use(
				new Elysia()
					.use(plugin.get('/p', (c: any) => String(c.who)))
					.get('/a', (c: any) => String(c.who))
			)
			.get('/g', (c: any) => String(c.who))

	const reach = async (app: { handle(r: Request): Promise<Response> }) => {
		const seen: Record<string, string | null> = {}
		for (const path of ['/p', '/a', '/g']) {
			const res = await app.handle(new Request(`http://localhost${path}`))
			const body = await res.text()
			seen[path] =
				res.headers.get('x-hook') ??
				(body === 'undefined' ? null : body)
		}

		return seen
	}

	it("'scoped' reaches the parent app but not the grandparent", async () => {
		expect(await reach(tree(header('scoped')))).toEqual({
			'/p': '1',
			'/a': '1',
			'/g': null
		})
		expect(await reach(tree(derived('scoped')))).toEqual({
			'/p': 'plugin',
			'/a': 'plugin',
			'/g': null
		})
	})

	it("'global' reaches the grandparent", async () => {
		expect(await reach(tree(header('global')))).toEqual({
			'/p': '1',
			'/a': '1',
			'/g': '1'
		})
		expect(await reach(tree(derived('global')))).toEqual({
			'/p': 'plugin',
			'/a': 'plugin',
			'/g': 'plugin'
		})
	})

	it("'local' stays on the declaring instance", async () => {
		expect(await reach(tree(header('local')))).toEqual({
			'/p': '1',
			'/a': null,
			'/g': null
		})
		expect(await reach(tree(derived('local')))).toEqual({
			'/p': 'plugin',
			'/a': null,
			'/g': null
		})
	})

	it("onError { as: 'scoped' } handles a parent route's error", async () => {
		const plugin = new Elysia().onError(
			{ as: 'scoped' },
			({ error }) => `handled ${(error as Error).message}`
		)
		const app = new Elysia().use(plugin).get('/', () => {
			throw new Error('boom')
		})

		const res = await app.handle(new Request('http://localhost/'))
		expect(res.status).toBe(500)
		expect(await res.text()).toBe('handled boom')
	})

	// `{}` names no scope, so the instance default applies as if omitted
	it('{} falls back to the instance scope', async () => {
		for (const options of [{}, { as: undefined }]) {
			const plugin = new Elysia({ as: 'plugin' }).onBeforeHandle(
				options as any,
				({ set }) => {
					set.headers['x-hook'] = '1'
				}
			)

			expect(await reach(tree(plugin))).toEqual({
				'/p': '1',
				'/a': '1',
				'/g': null
			})
		}
	})

	// bun test shares one process across files, so count in a fresh one
	it('warns once per process, and only for the object form', async () => {
		const proc = Bun.spawn({
			cmd: [
				process.execPath,
				'-e',
				`
				import { Elysia } from './src'
				let count = 0
				console.warn = (message) => {
					if (String(message).includes('{ as: scope } is deprecated')) count++
				}
				new Elysia()
					.onBeforeHandle('plugin', () => {})
					.derive('global', () => ({}))
				const positional = count
				new Elysia()
					.onBeforeHandle({ as: 'scoped' }, () => {})
					.derive({ as: 'global' }, () => ({}))
					.onError({ as: 'local' }, () => {})
					.trace({ as: 'scoped' }, () => {})
				new Elysia().mapResponse({ as: 'global' }, () => {})
				console.log(JSON.stringify({ positional, object: count }))
				`
			],
			cwd: resolve(import.meta.dir, '../..'),
			stdout: 'pipe',
			stderr: 'pipe'
		})

		const [stdout, stderr, exit] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited
		])

		expect(stderr).toBe('')
		expect(exit).toBe(0)
		expect(JSON.parse(stdout)).toEqual({ positional: 0, object: 1 })
	})
})
