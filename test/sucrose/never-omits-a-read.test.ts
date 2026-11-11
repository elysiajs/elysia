// @ts-nocheck
import { describe, expect, it } from 'bun:test'
import { inferParameterReads } from '../../src/sucrose'

// A plugin shares a handler's result across requests when the reader says
// which members it reads. A set that leaves out a real read hands one
// request's data to another, so each handler here runs against a recording
// context and the reader must answer `null` or a set holding every member read.
// Sources stay strings: the transpiler rewrites them.

const thisFree = new Set(
	'status problem redirect send publish subscribe unsubscribe close'.split(
		' '
	)
)

async function membersRead(handler: Function, sink: { value?: unknown }) {
	const read = new Set<string>()
	let everything = false
	let copying: string | symbol | undefined
	const owners = new WeakMap<object, string>()
	// listing or probing the context shows what it holds, unless a copy then takes each value
	const listing = Symbol()
	const probed = new Set<string | symbol>()

	let context
	const member = (name: string) => {
		const value = new Proxy(function () {}, {
			get(_, key) {
				read.add(name)
				if (key === Symbol.toPrimitive) return () => name
				if (typeof key === 'symbol' || key === 'then') return
				return member(name)
			},
			apply(_, self, args) {
				read.add(name)
				if (
					(self === context && !thisFree.has(name)) ||
					args.includes(context)
				)
					everything = true
				return member(name)
			},
			has() {
				read.add(name)
				return true
			}
		})
		owners.set(value, name)
		return value
	}

	const target = Object.fromEntries(
		['db', 'user', 'query', 'me', 'status'].map((key) => [key, 0])
	)
	context = new Proxy(target, {
		get(_, key) {
			if (typeof key !== 'string' || key === 'then') return
			// a spread or rest copies every member, reading none until used
			if (copying !== key) read.add(key)
			copying = undefined
			probed.delete(key)
			return member(key)
		},
		getOwnPropertyDescriptor(target, key) {
			copying = key
			probed.delete(listing)
			probed.add(key)
			return Reflect.getOwnPropertyDescriptor(target, key)
		},
		ownKeys(target) {
			probed.add(listing)
			return Reflect.ownKeys(target)
		},
		has() {
			everything = true
			return true
		}
	})

	const escape = (value, depth = 0) => {
		if (value === context) everything = true
		else if (owners.has(value)) read.add(owners.get(value))
		else if (value && typeof value === 'object' && depth < 4)
			for (const key of Object.keys(value)) escape(value[key], depth + 1)
	}

	try {
		let result = handler(context)
		// a generator's `return` value too, which iterating it drops
		if (typeof result?.next === 'function' && !owners.has(result)) {
			const values = []
			for (let step; !step?.done; ) {
				step = await result.next()
				values.push(step.value)
			}
			result = values
		}
		escape(await result)
	} catch {}
	escape(sink.value)
	if (probed.size) everything = true

	return { read, everything }
}

const handlers = [
	'(c) => c.db.scope',
	'c => c.db',
	'function (c) { return c.db }',
	'async (c) => (await c.db).scope',
	'function* (c) { yield c.db }',
	'async function* (c) { yield c.user }',
	'({ m(c) { return c.db } }).m',
	'({ 0(c) { return c.db } })[0]',
	`({ 'a(b'(c) { return c.db } })['a(b']`,
	'({ [f(a)](c) { return c.db } })[a]',
	'({ async [f(a)](c) { return c.db } })[a]',
	'({ *[f(a)](c) { yield c.db } })[a]',
	'({ async *[f(a)](c) { yield c.db } })[a]',
	'({ [`${f(a)}`](c) { return c.db } })[a]',
	`({ [(() => 'k')()](c) { return c.user } }).k`,
	`({ [']'](c) { return c.db } })[']']`,
	`({ ['('](c) { return c.db } })['(']`,
	`({ [']' + f(a)](c) { return c.db } })[']k']`,
	`Object.getOwnPropertyDescriptor({ set [f(a)](c) { sink.value = c.db } }, 'k').set`,
	'(class { static [f(a)](c) { return c.db } }).k',
	'((c) => c.db).bind(null)',
	'({ m(c = f(a)) { return c.db } }).m',
	'({ db: { scope } }) => scope',
	'({ db: d }) => d.scope',
	'({ db = 1, user: u = 2 }) => [db, u]',
	'({ db, ...rest }) => [db, rest.user]',
	'({ ...rest }) => rest',
	'(c) => { const { db } = c, u = c.user; return [db, u] }',
	'(c) => { let x; ({ db: x } = c); return x }',
	'(c) => { const { [k]: v } = c; return v }',
	'(c) => { const { ...r } = c; return r.user }',
	'(c) => { const x = c; return x.user }',
	'(c) => (x = c, x.user)',
	'(c) => [c][0].user',
	'(c) => load(c)',
	'(c) => c',
	'(c) => ({ ctx: c }).ctx.user',
	'function (c) { return arguments[0].user }',
	'function () { return arguments[0].user }',
	'(c) => c[k]',
	`(c) => c['db']`,
	`(c) => c['d\\x62']`,
	`(c) => c['\\u0075ser']`,
	'(c) => c[`user`]',
	`(c) => c?.['user']`,
	'(c) => ({ ...c }).user',
	'(c) => Object.entries(c)',
	`(c) => Reflect.get(c, 'user')`,
	`(c) => 'user' in c`,
	'function (c) { with (c) { return user } }',
	`(c) => eval('c.user')`,
	'(c) => [1].map(() => c.user)',
	'(c) => [1].map((c) => c)[0] + c.db',
	'(c) => /* c.user } ( */ c.db',
	`(c) => '} c.user (' + c.db`,
	'(c) => `}{ c.user ${c.db}`',
	'(c) => `a${c.db}b${c.user}c`',
	'(c) => { const r = /[}{(c.user)]/; return c.db }',
	`(c) => { let x = c.db\n/c.user/1; return x }`,
	'(\\u0063) => \\u0063.db',
	'(c) => c.\\u0064b',
	'function(e){let{db:t,user:n}=e;return[t,n]}',
	'(c, d = c.user) => d',
	'(c) => c.me()',
	'(c) => c.me`x`',
	'(c) => c.me /* } */ `x`',
	'(c) => c.m\\u{65}`x`',
	`(c) => c['me']\`x\``,
	'(c) => (c.me)()',
	'(c) => ((c.me))()',
	'(c) => (c?.me)()',
	'(c) => (c.me)`x`',
	`(c) => (c['me'])()`,
	'(c) => (0, c.me)()',
	'(c) => c.status(200, c.db)',
	`function ({ db = ')', user }) { return user }`,
	`(c = '(') => c.db`,
	`({ db = '{', user }) => user`,
	`(c) => { const { a = '{', user } = c; return [a, user] }`,
	`(c) => { const { a = '}', user } = c; return user }`,
	`({ m(c = '}') { const u = c.user; return (x) => u } }).m`,
	`(c) => { let x; x\n'='\nc + ''; return c.db }`
]

const delimiters = [
	'(',
	')',
	'[',
	']',
	'{',
	'}',
	'=>',
	'=',
	',',
	':',
	'.',
	'?.',
	'...'
]

// each slot holds the delimiter `d` in a string, a template or beside a call
const generated = (d: string) => {
	const names = [
		`'${d}'`,
		`'${d}' + f(a)`,
		`f(a) + '${d}'`,
		`f('${d}')`,
		`\`${d}\${f(a)}\``,
		`['${d}'][0]`,
		'[f(a)][0]',
		'f(a)',
		`(() => '${d}')()`
	]
	const callables = [
		'(P) => { B }',
		'async (P) => { B }',
		'function (P) { B }',
		'async function (P) { B }',
		'function* (P) { B }',
		'async function* (P) { B }',
		'({ m(P) { B } }).m',
		'({ async *m(P) { B } }).m',
		`Object.values({ '${d}'(P) { B } })[0]`,
		...names.flatMap((name) => [
			`Object.values({ [${name}](P) { B } })[0]`,
			`Object.values({ async [${name}](P) { B } })[0]`,
			`Object.values({ *[${name}](P) { B } })[0]`
		])
	]
	const parameters = [
		'c',
		'c, d',
		`c = '${d}'`,
		`c, d = '${d}'`,
		'{ db, ...c }',
		'{ db: x, ...c }',
		`{ db = '${d}', ...c }`,
		`{ '${d}': x, ...c }`,
		`{ [f('${d}')]: x, ...c }`,
		'...c'
	]
	const bodies = [
		'return c.user',
		`return c['user']`,
		'return c?.user',
		`return c['${d}']`,
		'const { user } = c; return user',
		`const { '${d}': y, user } = c; return [y, user]`,
		`const { me = '${d}', user } = c; return [me, user]`,
		`let y; y = c\n'${d}'\nreturn y.user`,
		'const y = c; return y.user',
		'return c.me()',
		`return c.status('${d}', c.user)`,
		`c.status\n'${d}'\nreturn c.user`,
		`return c.me\`${d}\``,
		`return \`${d}\${c.user}\``,
		'return [1].map(() => c.user)[0]',
		`return '${d}' + c.user`,
		`return { '${d}': c.user }`,
		`return c\n'${d}'`
	]

	return callables.flatMap((callable) =>
		parameters.flatMap((parameter) =>
			bodies.map((body) =>
				callable.replace('P', () => parameter).replace('B', () => body)
			)
		)
	)
}

// the members a handler reads that a non-null answer leaves out
async function missedReads(source: string) {
	const sink = {}
	const handler = new Function(
		'f',
		'a',
		'k',
		'load',
		'sink',
		`return ${source}`
	)(
		(n) => n,
		'k',
		'user',
		(c) => c.user,
		sink
	)

	const answer = inferParameterReads(
		Function.prototype.toString.call(handler),
		(member, call) => (call ? undefined : member),
		true
	)
	const { read, everything } = await membersRead(handler, sink)

	if (answer === null) return []
	if (everything) return ['everything']

	return [...read].filter(
		(member) => !thisFree.has(member) && !answer.has(member)
	)
}

describe('the reader never omits a member the handler really reads', () => {
	it('records the reads it checks against', async () => {
		const { read, everything } = await membersRead(
			(c) => [c.db, c.me()],
			{}
		)

		expect([...read]).toEqual(['db', 'me'])
		expect(everything).toBe(true)
	})

	it('counts listing or probing the context as reading everything, a copy as its uses', async () => {
		for (const probe of [
			(c) => Object.keys(c),
			(c) => Reflect.ownKeys(c),
			(c) => Object.getOwnPropertyDescriptor(c, 'db'),
			(c) => 'db' in c
		])
			expect((await membersRead(probe, {})).everything).toBe(true)

		const copy = await membersRead(({ db, ...rest }) => [db, rest.user], {})
		expect([...copy.read]).toEqual(['db', 'user'])
		expect(copy.everything).toBe(false)
	})

	for (const source of handlers)
		it(source, async () => {
			expect(await missedReads(source)).toEqual([])
		})

	// one fragment alone passed while `"]"` beside an inner call misread
	for (const d of delimiters)
		it(`reads every callable, parameter and body holding \`${d}\``, async () => {
			const unsound: string[] = []
			for (const source of generated(d))
				if ((await missedReads(source)).length) unsound.push(source)

			expect(unsound).toEqual([])
		})
})
