import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import { compileHandler } from '../../src/compile'
import { extractDeriveKeys } from '../../src/compile/handler/utils'
import { req } from '../utils'

/**
 * Derive key-wise merge harness (F45).
 *
 * Derive merge used to emit the generic reflective `Object.assign(c,tmp)`. F45
 * statically recovers the returned object literal's keys and emits monomorphic
 * `c.user=tmp.user` stores instead — 2.3-4x faster. The hazard is silent
 * over-match: a scanner that misreads the source DROPS keys (auth-context
 * corruption). So the scanner must extract the EXACT key set or BAIL to
 * Object.assign — never a partial set.
 *
 * This file pins (1) the scanner's exact key set / bail decision across a fuzz
 * set, (2) a differential check that the emitted merge deep-equals Object.assign
 * for every analyzable derive, (3) the codegen emission, and (4) end-to-end that
 * derived keys still reach the handler.
 */

afterEach(() => {
	Compiled.clear()
	Validator.clear()
})

const compileRoute = (app: any, index = 0) => {
	const route = (app as Elysia).history![index]
	const fn = compileHandler(route as any, app)
	return { fn, source: fn.toString() }
}

// Apply the keys the codegen WOULD emit (bracket-quoted stores), to compare
// against Object.assign — the merge must be observationally identical.
const applyKeyMerge = (keys: string[], src: Record<string, unknown>) => {
	const target: Record<string, unknown> = {}
	for (const k of keys) target[k] = src[k]
	return target
}

describe('F45: extractDeriveKeys exact key set or bail', () => {
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
		[(c: any) => ({ a: 'has,:}brace', b: 2 }), ['a', 'b'], 'punctuation in string value'],
		[(c: any) => ({ a: 1, b: 2 }), ['a', 'b'], 'trailing comma normalized'],
		[(c: any) => ({}), [], 'empty object']
	]

	for (const [fn, expected, label] of analyzable)
		it(`extracts ${label}`, () => {
			expect(extractDeriveKeys(fn)).toEqual(expected)
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
		// shorthand bail — built via `new Function` so the transpiler cannot expand
		// the `{ user, role }` shorthand (no `key:` colon) into explicit pairs; the
		// scanner must reject it.
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
		it(`bails on ${label}`, () => {
			expect(extractDeriveKeys(fn)).toBeNull()
		})
})

describe('F45: differential — key merge deep-equals Object.assign', () => {
	// For each analyzable derive, run it against a representative context and
	// confirm the keys-emitted merge produces the SAME object as Object.assign.
	const ctx = {
		b: 'bee',
		headers: { authorization: 'token' },
		params: { id: '42' }
	} as any

	const derives: Function[] = [
		() => ({ user: 'bob' }),
		() => ({ user: 'bob', role: 'admin' }),
		() => ({ user: 'bob', 'x-role': 'admin' }),
		(c: any) => ({ token: c.headers.authorization }),
		(c: any) => ({ id: c.params.id }),
		(c: any) => ({ a: c.b, d: () => ({ nested: 1 }) }),
		(c: any) => ({ a: { x: 1, y: 2 }, b: 3 })
	]

	for (const fn of derives)
		it(`merge parity for ${fn.toString().slice(0, 40)}`, () => {
			const keys = extractDeriveKeys(fn)
			expect(keys).not.toBeNull()

			const produced = (fn as any)(ctx)

			const viaAssign: Record<string, unknown> = {}
			Object.assign(viaAssign, produced)

			const viaKeys = applyKeyMerge(keys!, produced)

			expect(viaKeys).toEqual(viaAssign)
		})
})

describe('F45: codegen emission', () => {
	it('object-literal derive emits key-wise stores, not Object.assign', () => {
		const app = new Elysia()
			.derive(() => ({ user: 'bob', role: 'admin' }))
			.get('/', () => 'hi')

		const { source } = compileRoute(app)
		expect(source).toContain('c["user"]=tmp["user"]')
		expect(source).toContain('c["role"]=tmp["role"]')
		expect(source).not.toContain('Object.assign')
	})

	it('spread derive falls back to Object.assign', () => {
		const app = new Elysia()
			.derive((c: any) => ({ ...c.query }))
			.get('/', () => 'hi')

		const { source } = compileRoute(app)
		expect(source).toContain('Object.assign(c,tmp)')
	})

	it('conditional derive falls back to Object.assign', () => {
		const app = new Elysia()
			.derive((c: any) => {
				if ((c as any).query.x) return { a: 1 }
				return { b: 2 }
			})
			.get('/', () => 'hi')

		const { source } = compileRoute(app)
		expect(source).toContain('Object.assign(c,tmp)')
	})
})

describe('F45: end-to-end derived keys reach the handler', () => {
	it('static-key derive: keys are on the context', async () => {
		const app = new Elysia()
			.derive(() => ({ user: 'bob', role: 'admin' }))
			.get('/', (c: any) => `${c.user}:${c.role}`)

		const res = await app.handle(req('/'))
		expect(await res.text()).toBe('bob:admin')
	})

	it('string-key derive (hyphen): key reaches the handler', async () => {
		const app = new Elysia()
			.derive(() => ({ 'x-user': 'bob' }))
			.get('/', (c: any) => c['x-user'])

		const res = await app.handle(req('/'))
		expect(await res.text()).toBe('bob')
	})

	it('spread derive (bail path): keys still reach the handler', async () => {
		const app = new Elysia()
			.derive((c: any) => ({ ...{ user: 'bob', role: 'admin' } }))
			.get('/', (c: any) => `${c.user}:${c.role}`)

		const res = await app.handle(req('/'))
		expect(await res.text()).toBe('bob:admin')
	})

	it('multiple derives merge in order', async () => {
		const app = new Elysia()
			.derive(() => ({ a: 1 }))
			.derive((c: any) => ({ b: (c as any).a + 1 }))
			.get('/', (c: any) => `${c.a},${c.b}`)

		const res = await app.handle(req('/'))
		expect(await res.text()).toBe('1,2')
	})

	it('ElysiaStatus short-circuit from a derive still works', async () => {
		const app = new Elysia()
			.derive(({ status }: any) => {
				return status(418, 'teapot')
			})
			.get('/', () => 'unreached')

		const res = await app.handle(req('/'))
		expect(res.status).toBe(418)
		expect(await res.text()).toBe('teapot')
	})
})
