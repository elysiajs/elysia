import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import { compileHandler } from '../../src/compile/handler'

/** Derive keys must be recovered exactly or fall back to Object.assign. */

afterEach(() => {
	Compiled.clear()
	Validator.clear()
})

const compileRoute = (app: any, index = 0) => {
	const route = (app as Elysia)['~routes']![index]
	const fn = compileHandler(route as any, app)
	return { fn, source: fn.toString() }
}

const compileDerive = (derive: Function) =>
	compileRoute(
		new Elysia().derive(derive as any).get('/', () => 'hi')
	).source

describe('derive key codegen', () => {
	const analyzable: [Function, string[], string][] = [
		[() => ({ user: 'bob' }), ['user'], 'single identifier key'],
		[
			() => ({ user: 'bob', role: 'admin' }),
			['user', 'role'],
			'two identifier keys'
		],
		[
			() => ({ user: 'bob', 'x-role': 'admin' }),
			['user', 'x-role'],
			'string key (hyphen)'
		],
		[
			async (c: any) => ({ token: c.headers.authorization }),
			['token'],
			'async arrow'
		],
		[
			function named(c: any) {
				return { id: c.params.id }
			},
			['id'],
			'named function block single return'
		],
		[
			(c: any) => {
				return { a: 1 }
			},
			['a'],
			'arrow block single return'
		],
		[
			(c: any) => ({ a: c.b, d: () => ({ nested: 1 }) }),
			['a', 'd'],
			'nested-arrow value keeps top-level keys'
		],
		[
			(c: any) => ({ a: { x: 1, y: 2 }, b: 3 }),
			['a', 'b'],
			'nested object value'
		],
		[
			(c: any) => ({ a: 'has,:}brace', b: 2 }),
			['a', 'b'],
			'punctuation in string value'
		],
		[(c: any) => ({ a: 1, b: 2 }), ['a', 'b'], 'trailing comma normalized']
	]

	for (const [fn, expected, label] of analyzable)
		it(`emits exact stores for ${label}`, () => {
			const source = compileDerive(fn)
			const stores = source.match(/c\[[^\]]+\]=tmp\[[^\]]+\]/g) ?? []

			expect(stores).toEqual(
				expected.map(
					(key) =>
						`c[${JSON.stringify(key)}]=tmp[${JSON.stringify(key)}]`
				)
			)
			expect(source).not.toContain('Object.assign(c,tmp)')
		})

	const bails: [Function, string][] = [
		[(c: any) => ({ ...c.query }), 'spread'],
		[
			(c: any) => {
				if (c.query.x) return { a: 1 }
				return { b: 2 }
			},
			'conditional / multi return'
		],
		[(c: any) => ({ [(c as any).k]: 1 }), 'computed key'],
		// `new Function` preserves shorthand properties for the rejection case.
		[
			new Function('c', 'const user=1,role=2; return { user, role }'),
			'shorthand'
		],
		[
			(c: any) => ({
				get x() {
					return 1
				}
			}),
			'getter'
		],
		[
			(c: any) => ({
				foo() {
					return 1
				}
			}),
			'method shorthand'
		],
		[
			(c: any) => {
				;(c as any).foo = 1
			},
			'block with no return (void derive)'
		],
		[
			(c: any) => {
				return (c as any).foo
			},
			'block returns non-object'
		],
		[Object.assign, 'native fn']
	]

	for (const [fn, label] of bails)
		it(`falls back for ${label}`, () => {
			expect(compileDerive(fn)).toContain('Object.assign(c,tmp)')
		})
})

describe('end-to-end derived keys reach the handler', () => {
	it('static-key derive: keys are on the context', async () => {
		const app = new Elysia()
			.derive(() => ({ user: 'bob', role: 'admin' }))
			.get('/', (c: any) => `${c.user}:${c.role}`)

		const res = await app.handle('/')
		await expect(res.text()).resolves.toBe('bob:admin')
	})

	it('string-key derive (hyphen): key reaches the handler', async () => {
		const app = new Elysia()
			.derive(() => ({ 'x-user': 'bob' }))
			.get('/', (c: any) => c['x-user'])

		const res = await app.handle('/')
		await expect(res.text()).resolves.toBe('bob')
	})

	it('spread derive (bail path): keys still reach the handler', async () => {
		const app = new Elysia()
			.derive((c: any) => ({ ...{ user: 'bob', role: 'admin' } }))
			.get('/', (c: any) => `${c.user}:${c.role}`)

		const res = await app.handle('/')
		await expect(res.text()).resolves.toBe('bob:admin')
	})

	it('multiple derives merge in order', async () => {
		const app = new Elysia()
			.derive(() => ({ a: 1 }))
			.derive((c: any) => ({ b: (c as any).a + 1 }))
			.get('/', (c: any) => `${c.a},${c.b}`)

		const res = await app.handle('/')
		await expect(res.text()).resolves.toBe('1,2')
	})

	it('ElysiaStatus short-circuit from a derive still works', async () => {
		const app = new Elysia()
			.derive(({ status }: any) => {
				return status(418, 'teapot')
			})
			.get('/', () => 'unreached')

		const res = await app.handle('/')
		expect(res.status).toBe(418)
		await expect(res.text()).resolves.toBe('teapot')
	})
})
