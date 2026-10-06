import { Elysia } from '../../src'

import { describe, expect, it } from 'bun:test'

// `.use()` gives each consumer its own copy of a plugin's plain-object
// decorators, so a write through one cannot reach another. The copy must
// otherwise be the object the plugin decorated: its routes see the copy too
// once the plugin is used
describe('plugin decorator copy', () => {
	const json = (
		app: Elysia<any, any, any, any, any, any, any, any>,
		path: string
	) => app.handle(path).then((x) => x.json())

	it('keeps symbol and non-enumerable keys and flags', async () => {
		const symbol = Symbol('symbol')

		const config = { [symbol]: 'symbol' }
		Object.defineProperty(config, 'hidden', {
			value: 'hidden',
			enumerable: false
		})
		Object.defineProperty(config, 'readonly', {
			value: 'readonly',
			enumerable: true,
			writable: false
		})
		Object.defineProperty(config, 'replaceable', {
			value: 'replaceable',
			enumerable: true,
			writable: false,
			configurable: true
		})

		const read = ({ config }: any) => ({
			symbol: config[symbol],
			hidden: config.hidden,
			writable: Object.getOwnPropertyDescriptor(config, 'readonly')!
				.writable,
			replaceable: Object.getOwnPropertyDescriptor(config, 'replaceable')!
				.writable,
			own: Object.hasOwn(config, 'readonly')
		})

		const plugin = new Elysia({ name: 'config' })
			.decorate('config', config)
			.get('/plugin', read)

		const app = new Elysia().use(plugin).get('/', read)

		const expected = {
			symbol: 'symbol',
			hidden: 'hidden',
			writable: false,
			replaceable: false,
			own: true
		}

		expect(await json(app, '/')).toEqual(expected)
		expect(await json(app, '/plugin')).toEqual(expected)
	})

	it('reads a getter once per consumer, at .use(), and keeps what it returned', async () => {
		let reads = 0
		let created = 0

		const plugin = new Elysia({ name: 'lazy-client' }).decorate('db', {
			_client: undefined as { id: number } | undefined,
			get client() {
				reads++
				return (this._client ??= { id: ++created })
			}
		})

		const a = new Elysia()
			.use(plugin)
			.get('/', ({ db }: any) => db.client.id)
		const b = new Elysia()
			.use(plugin)
			.get('/', ({ db }: any) => db.client.id)

		// the copy holds what the getter returned at `.use()`: one client for
		// every consumer and request
		expect(await a.handle('/').then((x) => x.text())).toBe('1')
		expect(await b.handle('/').then((x) => x.text())).toBe('1')
		expect(await a.handle('/').then((x) => x.text())).toBe('1')
		expect(created).toBe(1)
		expect(reads).toBe(2)
	})

	it('keeps a frozen value frozen, so a merge into it is a no-op like a root decorator', async () => {
		const plugin = new Elysia({ name: 'limits' }).decorate('config', {
			limits: Object.freeze({ max: 1 })
		})

		const app = new Elysia()
			.use(plugin)
			.decorate('config', { limits: { extra: 1 } })
			.get('/', ({ config }: any) => ({
				frozen: Object.isFrozen(config.limits),
				limits: config.limits
			}))

		expect(await json(app, '/')).toEqual({
			frozen: true,
			limits: { max: 1 }
		})
	})

	it('copies an own __proto__ key as data, never as the prototype', async () => {
		const config = JSON.parse(
			'{ "__proto__": { "polluted": true }, "a": 1 }'
		)

		const plugin = new Elysia({ name: 'proto-key' }).decorate(
			'config',
			config
		)

		const app = new Elysia().use(plugin).get('/', ({ config }: any) => ({
			polluted: config.polluted === true,
			own: Object.hasOwn(config, '__proto__'),
			prototype: Object.getPrototypeOf(config)
		}))

		expect(await json(app, '/')).toEqual({
			polluted: false,
			own: true,
			prototype: null
		})
	})

	// `decorate(fn)` can make the table itself an object with a prototype: a
	// key shadowing that prototype's own is still copied
	let ran = 0
	for (const [name, prototype] of [
		[
			'a read-only property of the prototype shadows',
			Object.defineProperty({}, 'value', { value: 0, writable: false })
		],
		[
			'without running a setter of the prototype',
			{
				set value(_: unknown) {
					ran++
				}
			}
		]
	] as const)
		it(`copies a key ${name}`, async () => {
			const table = Object.create(prototype)
			Object.defineProperty(table, 'value', {
				value: 1,
				writable: true,
				enumerable: true,
				configurable: true
			})

			const plugin = new Elysia({ name }).decorate(() => table)

			const app = new Elysia()
				.use(plugin)
				.get('/', ({ value }: any) => value)

			expect(await app.handle('/').then((x) => x.text())).toBe('1')
			expect(ran).toBe(0)
		})

	it('copies a plain object without assigning through Object.prototype', async () => {
		let setter = 0
		// a polluted Object.prototype: the copy keeps it, so assigning a key
		// would hit the read-only one or run the setter
		Object.defineProperty(Object.prototype, '__elysiaReadonly', {
			value: 0,
			writable: false,
			configurable: true
		})
		Object.defineProperty(Object.prototype, '__elysiaSetter', {
			set() {
				setter++
			},
			configurable: true
		})

		try {
			const config: Record<string, number> = {}
			Object.defineProperty(config, '__elysiaReadonly', {
				value: 1,
				writable: true,
				enumerable: true,
				configurable: true
			})
			Object.defineProperty(config, '__elysiaSetter', {
				value: 2,
				writable: true,
				enumerable: true,
				configurable: true
			})

			const plugin = new Elysia({ name: 'polluted' }).decorate(
				'config',
				config
			)

			const app = new Elysia()
				.use(plugin)
				.get(
					'/',
					({ config }: any) =>
						`${config.__elysiaReadonly},${config.__elysiaSetter}`
				)

			expect(await app.handle('/').then((x) => x.text())).toBe('1,2')
			expect(setter).toBe(0)
		} finally {
			delete (Object.prototype as any).__elysiaReadonly
			delete (Object.prototype as any).__elysiaSetter
		}
	})

	it('copies what the table inherits, as the context sees it', async () => {
		const table = Object.assign(Object.create({ inherited: 'visible' }), {
			own: 'own'
		})

		const plugin = new Elysia({ name: 'inherited-member' }).decorate(
			() => table
		)

		const app = new Elysia()
			.use(plugin)
			.get('/', ({ inherited, own }: any) => `${inherited},${own}`)

		expect(await app.handle('/').then((x) => x.text())).toBe('visible,own')
	})

	it("reads a class table's getter on the instance, which holds its private field", async () => {
		class Table {
			#secret = 'branded'

			get secret() {
				return this.#secret
			}
		}
		Object.defineProperty(Table.prototype, 'secret', {
			...Object.getOwnPropertyDescriptor(Table.prototype, 'secret'),
			enumerable: true
		})

		const plugin = new Elysia({ name: 'class-table' }).decorate(
			() => new Table() as any
		)

		const app = new Elysia()
			.use(plugin)
			.get('/', ({ secret }: any) => secret)

		expect(await app.handle('/').then((x) => x.text())).toBe('branded')
	})

	it("does not keep a class table's prototype, whose methods would shadow a later decorator", async () => {
		class Table {
			read() {
				return 'method'
			}
		}

		const plugin = new Elysia({ name: 'class-methods' }).decorate(
			() => new Table() as any
		)

		// `decorate` without override skips a name the table already has
		const app = new Elysia()
			.use(plugin)
			.decorate('read', 'consumer')
			.get('/', ({ read }: any) => read)

		expect(await app.handle('/').then((x) => x.text())).toBe('consumer')
	})

	it('skips a key a getter read before it deleted, like for..in', async () => {
		const plugin = new Elysia({ name: 'deleting-getter' }).decorate(
			'config',
			{
				get first() {
					delete (this as any).later
					return 1
				},
				later: 'deleted'
			}
		)

		const app = new Elysia().use(plugin).get('/', ({ config }: any) => ({
			first: config.first,
			later: 'later' in config
		}))

		expect(await json(app, '/')).toEqual({ first: 1, later: false })
	})

	it("reads through a proxy's get trap, as the proxy answers", async () => {
		const config = new Proxy(
			{ value: 'raw' },
			{
				get(target, key, receiver) {
					return key === 'value'
						? 'public'
						: Reflect.get(target, key, receiver)
				}
			}
		)

		const plugin = new Elysia({ name: 'proxy-get' }).decorate(
			'config',
			config
		)

		const app = new Elysia()
			.use(plugin)
			.get('/', ({ config }: any) => config.value)

		expect(await app.handle('/').then((x) => x.text())).toBe('public')
	})

	// a copy has no prototype, as it always had: a name `Object.prototype`
	// holds is not one the table already has
	it('lets a later decorator take a name Object.prototype holds', async () => {
		const plugin = new Elysia({ name: 'literal-table' }).decorate(() => ({
			value: 'value'
		}))

		const app = new Elysia()
			.use(plugin)
			.decorate('toString', 'consumer')
			.get('/', ({ toString }: any) => toString)

		expect(await app.handle('/').then((x) => x.text())).toBe('consumer')
	})

	it("never copies Object.prototype's member back for a key a getter deleted", async () => {
		const plugin = new Elysia({ name: 'deleted-shadow' }).decorate(
			'config',
			{
				get first() {
					delete (this as any).toString
					return 1
				},
				toString: 'deleted'
			}
		)

		const app = new Elysia().use(plugin).get('/', ({ config }: any) => ({
			keys: Object.keys(config),
			own: Object.hasOwn(config, 'toString')
		}))

		expect(await json(app, '/')).toEqual({ keys: ['first'], own: false })
	})

	it('skips a non-enumerable key a non-enumerable getter deleted', async () => {
		const config = Object.defineProperties({} as Record<string, unknown>, {
			first: {
				get() {
					delete config.later
					return 1
				}
			},
			later: { value: 'deleted', configurable: true }
		})

		const plugin = new Elysia({ name: 'hidden-delete' }).decorate(
			'config',
			config
		)

		const app = new Elysia().use(plugin).get('/', ({ config }: any) => ({
			first: config.first,
			later: 'later' in config
		}))

		expect(await json(app, '/')).toEqual({ first: 1, later: false })
	})

	it('skips a non-enumerable getter that throws, which was never read before', async () => {
		const config = Object.defineProperty({ value: 'ok' }, 'hidden', {
			get() {
				throw new Error('hidden getter')
			}
		})

		const plugin = new Elysia({ name: 'hidden-throw' }).decorate(
			'config',
			config
		)

		const app = new Elysia().use(plugin).get('/', ({ config }: any) => ({
			value: config.value,
			hidden: 'hidden' in config
		}))

		expect(await json(app, '/')).toEqual({ value: 'ok', hidden: false })
	})

	it('still fails .use() on an enumerable getter that throws', () => {
		const plugin = new Elysia({ name: 'enumerable-throw' }).decorate(
			'config',
			{
				get value(): unknown {
					throw new Error('enumerable getter')
				}
			}
		)

		expect(() => new Elysia().use(plugin)).toThrow('enumerable getter')
	})

	it('still gives each consumer its own nested data', async () => {
		const plugin = new Elysia({ name: 'counter' }).decorate('state', {
			nested: { count: 0 }
		})

		const a = new Elysia()
			.use(plugin)
			.get('/', ({ state }: any) => ++state.nested.count)
		const b = new Elysia()
			.use(plugin)
			.get('/', ({ state }: any) => state.nested.count)

		await a.handle('/')

		expect(await b.handle('/').then((x) => x.text())).toBe('0')
	})
})
