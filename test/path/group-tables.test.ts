import { describe, expect, it } from 'bun:test'
import { Elysia, t } from '../../src'
import { post } from '../utils'

// A group child holds its parent's decorator / store / headers / models /
// parser tables by reference, as Elysia 1.x did. A per-group copy kept
// O(tables x groups) slots alive (800 models x 1000 groups = 34 MB) and made
// absorption merge every copied value back onto itself.

const tables = ['decorator', 'store', 'headers', 'models', 'parser'] as const

const text = (app: any, path: string | Request) =>
	app.handle(path).then((r: Response) => r.text())

const drain = () => Bun.sleep(1)

describe('group tables', () => {
	it('children write into the parent tables instead of copying them', () => {
		const children: any[] = []
		const app = new Elysia()
			.decorate('d', 1)
			.state('s', 1)
			.headers({ 'x-a': '1' })
			.parser('p', () => 'p')
			.model('M', t.String())

		for (let i = 0; i < 3; i++)
			app.group(`/${i}`, (g) => {
				children.push(g)

				return g.group('/n', (n) => {
					children.push(n)

					return n.get('/', () => 'ok')
				})
			})

		for (const child of children)
			for (const table of tables)
				expect(child['~ext'][table], table).toBe(app['~ext']![table])
	})

	it('keeps an untouched decorator intact', async () => {
		// a group used to merge every value it copied back onto the parent,
		// which re-cloned class-like plain objects and dropped their symbols
		const pool = {
			[Symbol.toStringTag]: 'Pool',
			[Symbol.dispose]() {},
			id: 1
		}

		const app = new Elysia()
			.decorate('pool', pool)
			.decorate('nest', { pool })
			.group('/g', (g) => g.get('/', () => 'ok'))
			.get('/', ({ pool: p, nest }) =>
				JSON.stringify([
					p === pool,
					nest.pool === pool,
					typeof p[Symbol.dispose]
				])
			)

		expect(await text(app, '/')).toBe('[true,true,"function"]')
	})

	it('writes inside a group reach the parent and its routes', async () => {
		const plugin = new Elysia({ name: 'group-tables-plugin' })
			.decorate('fromPlugin', 'plugin')
			.model('PluginModel', t.Number())

		// a group's writes reach the parent at runtime only; its type keeps
		// the pre-group singleton
		const app = (
			new Elysia()
				.decorate('a', 'a')
				.state('a', 'a')
				.model('A', t.String())
				.group('/g', (g) =>
					g
						.decorate('d', 'd')
						.state('s', 's')
						.headers({ 'x-g': '1' })
						.parser('upper', ({ request }) =>
							request.text().then((v) => v.toUpperCase())
						)
						.model('B', t.String())
						.use(plugin)
						.group('/n', (n) =>
							n.decorate('nested', 'n').model('N', t.String())
						)
				) as any
		)
			.post('/parse', { parse: 'upper' }, ({ body }: any) => body)
			.post('/model', { body: 'B' }, ({ body }: any) => body)
			.get(
				'/',
				({ d, store, nested, fromPlugin }: any) =>
					`${d}:${store.s}:${nested}:${fromPlugin}`
			)

		expect(Object.keys(app.models)).toEqual(['A', 'B', 'PluginModel', 'N'])

		const res = await app.handle('/')
		expect(await res.text()).toBe('d:s:n:plugin')
		expect(res.headers.get('x-g')).toBe('1')

		expect(await text(app, post('/parse', 'hi'))).toBe('HI')
		expect((await app.handle(post('/model', 1))).status).toBe(422)
	})

	it('a table a group mapper replaced still reaches the parent', async () => {
		const app = new Elysia()
			.decorate('a', 'a')
			.state('a', 'a')
			.model('A', t.String())
			.group('/g', (g) =>
				g
					.decorate((d) => ({ ...d, mapped: 'd' }))
					.state((s) => ({ ...s, mapped: 's' }))
					.model((m) => ({ ...m, Mapped: t.Number() }))
			)
			.get('/', (c: any) => `${c.a}:${c.mapped}:${c.store.mapped}`)

		expect(Object.keys(app.models)).toEqual(['A', 'Mapped'])
		expect(await text(app, '/')).toBe('a:d:s')
	})

	it('a parent without a table takes the one a plugin started in its group', async () => {
		let child: any
		const config = { k: 1 }
		const plugin = new Elysia({ name: 'group-tables-starter' })
			.decorate('config', config)
			.state('s', 1)
			.model('P', t.String())

		const app = new Elysia().group('/g', (g) => {
			child = g

			return g.use(plugin).get('/', ({ config: c }) => c.k)
		})

		for (const table of ['decorator', 'store', 'models'] as const)
			expect(child['~ext'][table], table).toBe(app['~ext']![table])

		// still a copy of the plugin's own object, never the object itself
		expect((app['~ext']!.decorator as any).config).not.toBe(config)
		expect(await text(app, '/g')).toBe('1')
	})

	it('a parent without a table takes the one its group started', async () => {
		let child: any
		const resource = {
			[Symbol.toStringTag]: 'Pool',
			[Symbol.dispose]() {}
		}

		const app = new Elysia().group('/g', (g) => {
			child = g

			return g
				.decorate('resource', resource)
				.state('s', 1)
				.headers({ 'x-g': '1' })
				.parser('p', () => 'p')
				.model('M', t.String())
				.get('/', ({ resource: r }) =>
					JSON.stringify([r === resource, typeof r[Symbol.dispose]])
				)
		})

		for (const table of tables)
			expect(child['~ext'][table], table).toBe(app['~ext']![table])

		expect(await text(app, '/g')).toBe('[true,"function"]')
	})

	it('child writes reach the parent at once and stay if the callback throws', () => {
		const app = new Elysia()
			.decorate('a', 1)
			.state('a', 1)
			.model('A', t.String())

		let seen: unknown
		app.group('/seen', (g) => {
			g.decorate('d', 1).state('s', 1).model('M', t.String())
			seen = [
				'd' in app['~ext']!.decorator!,
				's' in app['~ext']!.store!,
				'M' in app.models
			]

			return g
		})
		expect(seen).toEqual([true, true, true])

		expect(() =>
			app.group('/throws', (g) => {
				g.decorate('thrown', 1)
					.state('thrown', 1)
					.model('Thrown', t.String())

				throw new Error('callback failed')
			})
		).toThrow('callback failed')

		expect('thrown' in app['~ext']!.decorator!).toBe(true)
		expect('thrown' in app['~ext']!.store!).toBe(true)
		expect('Thrown' in app.models).toBe(true)
	})

	it('a mapper inside a group acts on the parent table', async () => {
		const app = new Elysia()
			.decorate('a', 1)
			.decorate('b', 2)
			.state('a', 1)
			.model('A', t.String())
			.model('B', t.String())
			.group('/g', (g) =>
				g
					.decorate((d) => {
						delete (d as any).a

						return d
					})
					.state((s) => {
						delete (s as any).a

						return s
					})
					.model((m) => {
						delete (m as any).A

						return m
					})
			)
			.get('/', (c: any) => `${c.a}:${c.b}:${c.store.a}`)

		expect(await text(app, '/')).toBe('undefined:2:undefined')
		expect(Object.keys(app.models)).toEqual(['B'])
	})

	it('a retained group child is a live alias of its parent tables', () => {
		let child: any
		const app = new Elysia().decorate('a', 1).model('A', t.String())

		app.group('/g', (g) => ((child = g), g))
		app.group('/s', (g) =>
			g.decorate('sibling', 1).model('Sibling', t.String())
		)
		app.decorate('late', 1).model('Late', t.String())

		expect(Object.keys(child['~ext'].decorator)).toEqual([
			'a',
			'sibling',
			'late'
		])
		expect(Object.keys(child.models)).toEqual(['A', 'Sibling', 'Late'])

		const other = new Elysia().use(child)
		expect(Object.keys(other.models)).toEqual(['A', 'Sibling', 'Late'])
		expect(other['~ext']!.models).not.toBe(app['~ext']!.models)
	})

	// A derive disposes only what it introduced. A resource a decorator or the
	// store already holds is shared, however late before the seal it got there
	it('does not dispose a decorator-held resource a group callback added', async () => {
		let disposed = 0
		const holder: { resource?: object } = {}
		const app = new Elysia().decorate('holder', holder).group('/g', (g) => {
			holder.resource = {
				[Symbol.dispose]() {
					disposed++
				}
			}

			return g
				.derive(() => ({ resource: holder.resource }))
				.get('/', () => 'ok')
		})

		await text(app, '/g')
		await drain()

		expect(disposed).toBe(0)
	})

	it('does not dispose a decorated or stored resource added after registration', async () => {
		let disposed = 0
		const resource = () => ({
			[Symbol.dispose]() {
				disposed++
			}
		})
		const holder: { resource?: object } = {}
		const box: { resource?: object } = {}

		const app = new Elysia()
			.decorate('holder', holder)
			.state('box', box)
			.derive(() => ({
				fromDecorator: holder.resource,
				fromStore: box.resource
			}))
			.get('/', () => 'ok')

		holder.resource = resource()
		box.resource = resource()

		await text(app, '/')
		await drain()

		expect(disposed).toBe(0)
	})

	it('the seal pass reads no store getter and survives a throwing proxy', async () => {
		// the store is handed to the context by reference, so nothing on the
		// request path reads its getters either (decorators are spread into
		// the context, which reads theirs anyway)
		let store: any
		let reads = 0
		const app = new Elysia()
			.state((s) => ((store = s), s))
			.get('/', () => 'ok')

		Object.defineProperty(store, 'unused', {
			enumerable: true,
			configurable: true,
			get() {
				reads++
				throw new Error('unused getter read')
			}
		})
		store.proxy = new Proxy(
			{},
			{
				ownKeys() {
					throw new Error('proxy trap ran')
				}
			}
		)

		expect(await text(app, '/')).toBe('ok')
		expect(reads).toBe(0)
	})

	it('the seal pass walks a graph many entries share once', async () => {
		let descriptors = 0
		const shared = new Proxy(
			Object.fromEntries(Array.from({ length: 100 }, (_, i) => [i, {}])),
			{
				getOwnPropertyDescriptor(target, key) {
					descriptors++

					return Reflect.getOwnPropertyDescriptor(target, key)
				}
			}
		)

		const app = new Elysia()
		for (let i = 0; i < 50; i++) app.state(`s${i}`, shared)
		app.get('/', () => 'ok')

		descriptors = 0
		expect(await text(app, '/')).toBe('ok')
		// once: ~2 reads per key; once per entry would be 50x that
		expect(descriptors).toBeLessThan(1000)
	})

	it('a failed publication leaves no half-built router', async () => {
		// white-box: a throwing ~ext read stands in for any failure while the
		// app publishes its generation, after the router is built
		const app = new Elysia().get('/', () => 'ok')
		let fail = true
		Object.defineProperty(app['~ext'] ?? (app['~ext'] = {}), 'hoc', {
			configurable: true,
			get() {
				if (fail) throw new Error('publication failed')
			}
		})

		await expect(app.handle('/')).rejects.toThrow('publication failed')

		fail = false
		expect(await text(app, '/')).toBe('ok')
	})

	it('a child appending to a borrowed table keeps keys it cannot enumerate', () => {
		const key = Symbol('token')
		let child: any
		const app = new Elysia().group('/g', (g) => ((child = g), g))
		app.state((s: any) => {
			s[key] = 'parent'

			return Object.defineProperty(s, 'hidden', {
				value: 'parent',
				writable: true
			})
		})

		child.state({ [key]: 'child', hidden: 'child', text: 'added' })

		const store: any = app['~ext']!.store
		expect([store[key], store.hidden, store.text]).toEqual([
			'parent',
			'parent',
			'added'
		])
	})

	it('a child appending to a frozen borrowed table does not throw', () => {
		let child: any
		const app = new Elysia().group('/g', (g) => ((child = g), g))
		app.state((s: any) => Object.freeze(s))

		expect(() => child.state({ text: 'added' })).not.toThrow()
		expect(Object.keys(app['~ext']!.store!)).toEqual([])
	})

	it('an identity mapper inside a group keeps sharing the parent table', async () => {
		let child: any
		const app = new Elysia()
			.decorate('d', 1)
			.state('s', 1)
			.model('M', t.Object({ x: t.String() }))

		app.group('/g', (g: any) => {
			child = g

			return g
				.decorate((d: any) => d)
				.state((s: any) => s)
				.model((m: any) => m)
				.macro({ checked: () => ({ body: g.models.M }) })
				.post('/x', { checked: true }, ({ body }: any) => body)
		})

		app.model('M', t.Object({ x: t.Number() }))

		for (const table of ['decorator', 'store', 'models'] as const)
			expect(child['~ext'][table], table).toBe(app['~ext']![table])

		// the lazy macro reads the parent's current M through the child
		expect((await app.handle(post('/g/x', { x: 1 }))).status).toBe(200)
		expect((await app.handle(post('/g/x', { x: 'invalid' }))).status).toBe(
			422
		)
	})

	it('a table the parent lacks is shared from the first write in the callback', () => {
		const writes: Array<[(typeof tables)[number], (g: any) => unknown]> = [
			['decorator', (g) => g.decorate('added', 1)],
			['store', (g) => g.state('added', 1)],
			['headers', (g) => g.headers({ added: '1' })],
			['parser', (g) => g.parser('added', () => '1')],
			['models', (g) => g.model('added', t.String())]
		]

		for (const [table, write] of writes) {
			const app = new Elysia()
			let seen: unknown

			expect(() =>
				app.group('/g', (g) => {
					write(g)
					seen = 'added' in (app['~ext']?.[table] ?? {})

					throw new Error('stop')
				})
			).toThrow('stop')

			expect(seen, table).toBe(true)
			expect('added' in (app['~ext']?.[table] ?? {}), table).toBe(true)
		}
	})

	it('a group shares a table its parent starts after group()', async () => {
		let child: any
		const app = new Elysia()

		app.group('/g', (g) => {
			child = g

			return g
				.decorate('group', 1)
				.use(Promise.resolve(new Elysia().get('/x', () => 'x')))
		})
		app.decorate('parent', 1).state('parent', 1).model('Late', t.String())
		await app.modules

		child.decorate('late', 1)
		expect(child['~ext'].decorator).toBe(app['~ext']!.decorator)
		expect(Object.keys(app['~ext']!.decorator!)).toEqual([
			'group',
			'parent',
			'late'
		])

		// store and models were never written through the child: its first
		// write (still appending) and the getter reach the parent's tables
		child.state({ parent: 2, child: 1 })
		expect(child['~ext'].store).toBe(app['~ext']!.store)
		expect({ ...app['~ext']!.store }).toEqual({ parent: 1, child: 1 })

		expect(child.models).toBe(app.models)
		child.model('ChildLate', t.String())
		expect(Object.keys(app.models)).toEqual(['Late', 'ChildLate'])
	})

	it('a pending group does not revert a later parent override', async () => {
		const app = new Elysia().decorate('v', 1)
		app.group('/g', (g) =>
			g.use(Promise.resolve(new Elysia().get('/x', () => 'x')))
		)
		app.decorate('override', 'v', 2)
		await app.modules

		app.get('/v', ({ v }) => String(v))

		expect(await text(app, '/v')).toBe('2')
		expect(await text(app, '/g/x')).toBe('x')
	})

	it('an object decorated inside a group keeps its identity', async () => {
		const config = { a: 1 }
		const app = new Elysia()
			.decorate('seed', 0)
			.group('/g', (g) =>
				g
					.decorate('config', config)
					.get('/', ({ config: c }) => c === config)
			)

		expect(await text(app, '/g')).toBe('true')
	})

	it('a macro reading the group models at compile time keeps validating', async () => {
		const app = new Elysia()
			.model('M', t.Object({ x: t.String() }))
			.group('/g', (g: any) =>
				g
					.macro({ checked: () => ({ body: g.models.M }) })
					.post('/x', { checked: true }, ({ body }: any) => body)
			)

		expect((await app.handle(post('/g/x', { x: 123 }))).status).toBe(422)
		expect((await app.handle(post('/g/x', { x: 'ok' }))).status).toBe(200)
	})

	it('two apps using one plugin never see each other writes', async () => {
		let child: any
		const plugin = new Elysia({ name: 'group-tables-reused' })
			.decorate('d', 'plugin')
			.state('s', 'plugin')
			.model('P', t.String())
			.group('/g', (g) => {
				child = g

				return g.get('/', ({ d, store }) => `${d}:${store.s}`)
			})

		const a = new Elysia().use(plugin)
		const b = new Elysia().use(plugin)

		a.decorate('override', 'd', 'a')
			.state('override', 's', 'a')
			.model('A', t.String())
		child.decorate('override', 'd', 'child').state('override', 's', 'child')

		for (const table of ['decorator', 'store', 'models'] as const) {
			expect(a['~ext']![table]).not.toBe(b['~ext']![table])
			expect(a['~ext']![table]).not.toBe(plugin['~ext']![table])
		}

		expect(await text(a, '/g')).toBe('a:a')
		expect(await text(b, '/g')).toBe('plugin:plugin')
		expect(Object.keys(b.models)).toEqual(['P'])
	})
})

describe('group tables after the root is sealed', () => {
	// a retained child shares the root's live tables, so it must refuse every
	// write the root itself refuses
	const sealedApp = async () => {
		let child: any

		const app = new Elysia()
			.decorate('d', 'before')
			.state('s', 'before')
			.headers({ 'x-a': 'before' })
			.parser('p', () => ({ from: 'before' }))
			.model('M', t.Object({ value: t.String() }))
			.group('/g', (g) => ((child = g), g))
			.get('/warm', ({ d, store }) => `${d}:${store.s}`)
			.get('/cold', ({ d, store }) => `${d}:${store.s}`)
			.post('/parse-warm', { parse: 'p' }, ({ body }) => body)
			.post('/parse-cold', { parse: 'p' }, ({ body }) => body)
			.post('/model-warm', { body: 'M' }, ({ body }) => body)
			.post('/model-cold', { body: 'M' }, ({ body }) => body)

		expect(await text(app, '/warm')).toBe('before:before')
		await text(app, post('/parse-warm', {}))
		await app.handle(post('/model-warm', { value: 'ok' }))

		return { app, child }
	}

	const writes: Array<[api: string, form: string, (g: any) => unknown]> = [
		['decorate', 'name', (g) => g.decorate('override', 'd', 'after')],
		['decorate', 'object', (g) => g.decorate({ late: 1 })],
		[
			'decorate',
			'mapper',
			(g) => g.decorate((d: any) => ({ ...d, late: 1 }))
		],
		['state', 'name', (g) => g.state('override', 's', 'after')],
		['state', 'object', (g) => g.state({ late: 1 })],
		['state', 'mapper', (g) => g.state((s: any) => ({ ...s, late: 1 }))],
		['headers', 'object', (g) => g.headers({ 'x-a': 'after' })],
		['parser', 'name', (g) => g.parser('p', () => ({ from: 'after' }))],
		['model', 'name', (g) => g.model('M', t.Object({ value: t.Number() }))],
		['model', 'object', (g) => g.model({ Late: t.String() })],
		[
			'model',
			'mapper',
			(g) => g.model((m: any) => ({ ...m, Late: t.String() }))
		],
		['use', 'plugin', (g) => g.use(new Elysia().state('late', 1))],
		[
			'group',
			'nested group',
			(g) => g.group('/n', (n: any) => n.state('late', 1))
		],
		[
			'group',
			'guard callback',
			(g) => g.guard({}, (n: any) => n.state('late', 1))
		]
	]

	for (const [api, form, write] of writes)
		it(`${api}() (${form}) on a retained child throws`, async () => {
			const { app, child } = await sealedApp()
			const before = Object.fromEntries(
				tables.map((table) => [table, { ...app['~ext']![table] }])
			)

			expect(() => write(child)).toThrow(
				`[Elysia] .${api}() called after the app was sealed by its first request, listen or compile`
			)

			for (const table of tables)
				expect({ ...app['~ext']![table] }, table).toEqual(before[table])

			for (const path of ['/warm', '/cold']) {
				const res = await app.handle(path)
				expect(await res.text()).toBe('before:before')
				expect(res.headers.get('x-a')).toBe('before')
			}

			for (const path of ['/parse-warm', '/parse-cold'])
				expect(await text(app, post(path, {}))).toBe(
					'{"from":"before"}'
				)

			for (const path of ['/model-warm', '/model-cold']) {
				expect(
					(await app.handle(post(path, { value: 'ok' }))).status
				).toBe(200)
				expect(
					(await app.handle(post(path, { value: 1 }))).status
				).toBe(422)
			}
		})

	it('a nested child kept past its callback throws too', async () => {
		let nested: any
		const app = new Elysia()
			.state('s', 'before')
			.group('/g', (g) => g.group('/n', (n) => ((nested = n), n)))
			.get('/', ({ store }) => store.s)

		expect(await text(app, '/')).toBe('before')
		expect(() => nested.state('override', 's', 'after')).toThrow(
			'[Elysia] .state() called after the app was sealed by its first request, listen or compile'
		)
		expect(await text(app, '/')).toBe('before')
	})

	it('a child of an unsealed plugin can still write', () => {
		let child: any
		const plugin = new Elysia({ name: 'group-tables-unsealed' })
			.decorate('d', 1)
			.group('/g', (g) => ((child = g), g))

		const root = new Elysia().use(plugin)
		root.compile()

		expect(() => child.decorate('late', 1)).not.toThrow()
		expect('late' in plugin['~ext']!.decorator!).toBe(true)
		expect('late' in root['~ext']!.decorator!).toBe(false)
	})
})
