import { describe, it, expect, afterEach } from 'bun:test'
import { Elysia } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import { emittedSource } from '../utils'

/** Derive keys must be recovered exactly or fall back to Object.assign. */

afterEach(() => {
	Compiled.clear()
	Validator.clear()
})

const compileRoute = (app: any, index = 0) => ({
	source: emittedSource(app, index)
})

// the route only: its async tail `_t`, hoisted before it, repeats the pipeline
const compileDerive = (derive: Function) => {
	const source = compileRoute(
		new Elysia().derive(derive as any).get('/', () => 'hi')
	).source

	return source.slice(source.indexOf('function route(c){'))
}

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
		[(c: any) => ({ a: 1, b: 2 }), ['a', 'b'], 'trailing comma normalized'],
		// a regex is skipped whole, so its quote or brace ends nothing
		[
			(c: any) => ({
				bearer: c.headers.authorization?.replace(/^Bearer /, ''),
				mobile: /[}'"]/.test(c.path)
			}),
			['bearer', 'mobile'],
			'regex in value'
		],
		// a keyword after `.` is a property, so `/` divides: read as a regex
		// it would swallow `b` up to the next `/` on the line
		[
			new Function('return (c) => ({ a: c.in / 2, b: c?.of / 3 })')(),
			['a', 'b'],
			'division after a keyword-named member'
		],
		[
			new (class {
				#in = 4
				derive = () => ({ a: this.#in / 2, b: this.#in / 4 })
			})().derive,
			['a', 'b'],
			'division after a keyword-named private member'
		],
		[
			new Function('return (c) => ({ a: 1./2, b: 1./3 })')(),
			['a', 'b'],
			'division after a trailing-dot number'
		]
	]

	for (const [fn, expected, label] of analyzable)
		it(`emits exact stores for ${label}`, () => {
			const source = compileDerive(fn)
			// each key is read once into `_v`, offered to disposal registration,
			// then stored - one group per extracted key, in order
			const stores = Array.from(
				source.match(/_v=tmp\[[^\]]+\];dsp\(c,_v\);c\[[^\]]+\]=_v/g) ??
					[]
			)

			expect(stores).toEqual(
				expected.map((key) => {
					const k = JSON.stringify(key)

					return `_v=tmp[${k}];dsp(c,_v);c[${k}]=_v`
				})
			)
			expect(source).not.toContain('_v=Object.assign({},tmp)')
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
		[Object.assign, 'native fn'],
		// `new Function`: the transpiler folds `({ a: 1 }).a` to `1`
		[
			new Function('return (c) => ({ a: 1 }).a')(),
			'literal is not the whole returned value'
		],
		// `of` may be a variable (minifiers emit it), so `of / 2` may divide:
		// read as a regex it would swallow `b` up to the next `/`
		[
			new Function('of', 'return (c) => ({ a: of / 2, b: of / 3 })')(12),
			'division by a variable named `of`'
		]
	]

	for (const [fn, label] of bails)
		it(`falls back for ${label}`, () => {
			// the keyless merge materializes one copy into `_v`, then registers
			// and assigns per key
			expect(compileDerive(fn)).toContain('_v=Object.assign({},tmp)')
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

	// the keyed path would store `undefined` under the literal's keys
	it('a literal that is not the returned value merges no key', async () => {
		const app = new Elysia()
			.derive(new Function('return () => ({ a: 1 }).a')())
			.get('/', (c: any) => String('a' in c))

		const res = await app.handle('/')
		await expect(res.text()).resolves.toBe('false')
	})

	it('division after a keyword-named member keeps every key', async () => {
		const app = new Elysia()
			.derive(
				new Function(
					'return ({ query }) => ({ ratio: query.in / 60, total: query.out / 60 })'
				)()
			)
			.get('/', (c: any) => `${c.ratio}|${c.total}`)

		const res = await app.handle('/?in=120&out=180')
		await expect(res.text()).resolves.toBe('2|3')
	})

	it('division by a variable named `of` keeps every key', async () => {
		const app = new Elysia()
			.derive(
				new Function(
					'return ({ query: { offset: of, user: n } }) => ({ page: of / 10, banned: n === "mallory", size: of / 2 })'
				)()
			)
			.get('/', (c: any) => `${c.page}|${c.banned}|${c.size}`)

		const res = await app.handle('/?user=mallory&offset=20')
		await expect(res.text()).resolves.toBe('2|true|10')
	})

	// a regex after an `if` / `for` header or a block `}` read as a division
	// scans its body as code: `[/]` opens a phantom regex, the returned
	// object ends early and the keyed merge drops `banned`
	it.each([
		['an `if` header', 'if (s) /[/]/.test(s)'],
		['a `for` header', 'for (const x of s) /[/]/.test(x)'],
		['a `for await` header', 'for await (const x of s) /[/]/.test(x)'],
		['a block', 'if (s) { s }\n/[/]/.test(s)']
	])('a regex statement after %s keeps every key', async (_, statement) => {
		const app = new Elysia()
			.derive(
				new Function(
					`return ({ query }) => {\n return { check: async (s) => { ${statement} }, banned: query.user === "mallory" }\n}`
				)()
			)
			.get('/', (c: any) => `${typeof c.check}|${c.banned}`)

		const res = await app.handle('/?user=mallory')
		await expect(res.text()).resolves.toBe('function|true')
	})

	// U+2028 ends a `//` comment: the `if` after it runs, so there are two
	// returns and the merge must not be keyed on the last one
	it('a comment ended by U+2028 does not hide an early return', async () => {
		const app = new Elysia()
			.derive(
				new Function(
					'return ({ query }) => { // note\u2028if (query.ban) return { banned: true, user: query.name }\n return { user: query.name } }'
				)()
			)
			.get('/', (c: any) => `${c.banned}|${c.user}`)

		const res = await app.handle('/?ban=1&name=mallory')
		await expect(res.text()).resolves.toBe('true|mallory')
	})

	// `.5` is a number (Bun reprints `0.5`, Node keeps it): read as a `.` it
	// makes `void` a property name, so the regex after it divides and the
	// `/` in the comment opens a regex that hides the early return
	it('a line ending in `.5` does not hide an early return', async () => {
		const app = new Elysia()
			.derive(
				new Function(
					"return ({ query }) => {\n let r = .5\n void /a*/.test(''); if (query.ban) return { banned: true, user: query.name } // y/\n return { user: query.name }\n}"
				)()
			)
			.get('/', (c: any) => `${c.banned}|${c.user}`)

		const res = await app.handle('/?ban=1&name=mallory')
		await expect(res.text()).resolves.toBe('true|mallory')
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
