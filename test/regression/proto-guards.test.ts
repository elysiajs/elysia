import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'
import {
	aotReconstructHandle,
	jitHandle,
	type LaneFactory
} from '../differential/lanes'

// raw JSON text: a parsed object owns a real `__proto__` key, which a
// `__proto__:` object literal would not
const parsed = () =>
	JSON.parse('{"__proto__":{"polluted":"yes","defer":"hijacked"},"x":1}')

const inspect = (c: any) => ({
	polluted: c.polluted ?? null,
	defer: typeof c.defer,
	storePolluted: c.store?.polluted ?? null
})

const clean = { polluted: null, defer: 'function', storePolluted: null }

const get = (app: any, path = '/') =>
	app
		.handle(new Request('http://localhost' + path))
		.then((r: Response) => r.json())

describe('prototype-pollution guards', () => {
	// `decorate`'s own guards see only what it is handed and what a mapper
	// returns. A group child's mapper receives the parent's table, shared: if it
	// writes a parsed object into it in place and returns another table, the
	// parent keeps an own `__proto__` no `decorate` guard saw. The context
	// build (`decoratorMembers`) is the one sink every table reaches, so it
	// drops the key there; without it `Object.assign` onto the decorator
	// prototype runs the `__proto__` setter and cuts the Decorator base out
	it('the context build drops a __proto__ written into a shared table in place', async () => {
		const app = new Elysia()
			.decorate('a', 1)
			.group('/g', (g) =>
				g.decorate((table: any) => {
					Object.assign(table, parsed())
					return { a: table.a }
				})
			)
			.get('/', inspect)

		expect(await get(app)).toEqual(clean)
	})

	// The store has no such sink: the context hands the table itself to the
	// handler. An own `__proto__` left by the first object call survives until
	// a later mapper copies the table with `Object.assign({}, store)`, which
	// makes the payload the new store's prototype. Only the first-call delete
	// in `state` prevents it
	it('a later state mapper cannot inherit from a parsed first state call', async () => {
		const app = new Elysia()
			.state(parsed())
			.state((store: any) => Object.assign({}, store))
			.get('/', inspect)

		expect(await get(app)).toEqual(clean)
	})

	const storeOf = ({ store }: any) => ({
		own: Object.hasOwn(store, '__proto__'),
		polluted: store.polluted ?? null
	})

	// a group child's state mapper receives the parent's table, shared: an
	// in-place write leaves the parent an own `__proto__` no `state` guard
	// saw. `#absorbExt` drops it when the group is merged back, before the
	// later copy mapper can make it the store's prototype
	it('a group state mapper cannot leave __proto__ in the shared store', async () => {
		const app = new Elysia()
			.state('a', 1)
			.group('/g', (g) =>
				g.state((table: any) => {
					Object.assign(table, parsed())
					return { a: table.a }
				})
			)
			.state((store: any) => Object.assign({}, store))
			.get('/', storeOf)

		expect(await get(app)).toEqual({ own: false, polluted: null })
	})

	// a plugin from another copy (an older one without the guards) can hand
	// over a store that already owns `__proto__`
	it('use() drops __proto__ from an absorbed plugin store', async () => {
		const plugin = new Elysia().state('a', 1)
		Object.defineProperty((plugin as any)['~ext'].store, '__proto__', {
			value: { polluted: 'yes' },
			enumerable: true,
			writable: true,
			configurable: true
		})

		const app = new Elysia()
			.use(plugin)
			.state((store: any) => Object.assign({}, store))
			.get('/', storeOf)

		expect(await get(app)).toEqual({ own: false, polluted: null })
	})

	// a derive result whose keys are not extracted at compile time (`mergeDerive`)
	// keeps an own `__proto__` as inert data on the context: never the
	// prototype, never dropped. Dropping it would also be safe, but would make
	// the keyless merge disagree with `replaceDeriveContext` (mapDerive) and
	// with the keyed lane's bail on `__proto__`
	const lanes: LaneFactory[] = [jitHandle, aotReconstructHandle]

	for (const lane of lanes)
		it(`keyless derive keeps an own __proto__ as data (${lane.id})`, async () => {
			const instance = await lane.make((app) =>
				app
					.derive(({ request }: any) =>
						JSON.parse(request.headers.get('x-derive') ?? '{}')
					)
					.get('/', (c: any) => ({
						...inspect(c),
						own: Object.hasOwn(c, '__proto__'),
						data: c['__proto__']?.polluted ?? null,
						x: c.x
					}))
			)

			try {
				const response = await instance.handle(
					new Request('http://localhost/', {
						headers: {
							'x-derive': '{"__proto__":{"polluted":"yes"},"x":1}'
						}
					})
				)

				expect(await response.json()).toEqual({
					...clean,
					own: true,
					data: 'yes',
					x: 1
				})
			} finally {
				await instance.dispose()
			}
		})
})
