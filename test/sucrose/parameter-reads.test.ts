// @ts-nocheck
import { describe, expect, it } from 'bun:test'
import { Elysia } from '../../src'
import { inferParameterReads, sucrose } from '../../src/sucrose'
import { unionTracePhases } from '../../src/trace'
import packageJson from '../../package.json'

// A plugin reads a handler at boot to decide whether it can run without a
// request. An answer that misses a read runs a handler that reads the request
// without one, so `null`, can't tell, is the only safe answer to anything the
// scan cannot follow. Sources stay strings: the transpiler rewrites quotes.

// A method call is left out, so the reader gives up on it
const memberRead = (member: string, call?: boolean) =>
	call ? undefined : member

const reads = (source: string) => {
	const members = inferParameterReads(source, memberRead, true)

	return members && [...members].sort()
}

const table = (rows: [source: string, expected: string[] | null][]) => {
	for (const [source, expected] of rows)
		it(source, () => expect(reads(source)).toEqual(expected))
}

const compile = (source: string) => new Function(`return ${source}`)()

const everyChannel = {
	query: true,
	headers: true,
	body: true,
	cookie: true,
	set: true,
	route: true,
	afterResponse: true
}

describe('a renamed member reads the member, not the local', () => {
	// A minifier renames every binding. Counting the local reads `a`, which no
	// allowlist holds, so sharing would silently end in production
	table([
		['({ iris: a }) => a.share', ['iris']],
		['function({iris:e}){return e.share}', ['iris']],
		['({ iris: a = 1, params: b = 2 }) => b', ['iris', 'params']],
		// the local must not stand in for the member it shadows
		['({ user: iris }) => iris.name', ['user']],
		['({ user: params }) => params.id', ['user']]
	])
})

describe('a key the scan cannot name returns null', () => {
	// Reading only the local would answer `iris` for a read of `user`
	table([
		['({ "user": iris }) => iris.name', null],
		[`({ 'user': u }) => u.name`, null],
		['({ iris, "user": u }) => u.name', null],
		['({ "user": { name } }) => name', null],
		['(c) => { const { "user": iris } = c; return iris.name }', null],
		[`(c) => { let{'user':e}=c; return e.name }`, null]
	])

	// The scan drops numbers, so `{ 0: a }` reaches the reader as `{ : a }`
	table([
		['({ 0: a }) => a', null],
		['({ iris, 0: a }) => a', null],
		['(c) => { const { 0: a } = c; return a }', null]
	])
})

describe('a later parameter that can reach the first returns null', () => {
	// A default runs when the handler is called, and the body scan never sees it
	table([
		['(c = {}, d = c.user) => d', null],
		['({ ...iris }, x = iris.user.name) => x', null],
		['(c, d = c) => d.user', null],
		['(c, { d = c.user }) => d', null],
		['({ ws }, d = ws.user) => d', null],
		['({ ws: w }, d = w.user) => d', null],
		['function (c, d = arguments[0].user) { return d }', null],
		[`(c, d = eval('c.user')) => d`, null],
		// a string holding a bracket must not hide the comma
		[`(c = '{', d = c.user) => d`, null],
		[`(c = '}', d = c.user) => d`, null],
		[`(c = '[', d = c.user) => d`, null],
		// a default in the first parameter reaches the context the same way
		['function({x:query=arguments[0]}){return query.query}', null],
		[
			'function({x:onRequest=arguments[0]}){return onRequest.onRequest}',
			null
		],
		['function({x=arguments[0].me()}){return x}', null],
		[`({ x = eval('c') }) => x`, null]
	])
})

describe('destructuring in the body reads members', () => {
	// What a minifier leaves of `const { iris, params } = context`
	table([
		[
			'(t) => { let{iris:s,params:e}=t; return s.share + e.id }',
			['iris', 'params']
		],
		['(t) => { let{iris:s,user:e}=t; return e.id }', ['iris', 'user']],
		['(t) => { const { user: iris } = t; return iris.name }', ['user']],
		[
			'(t) => { const { iris: { share }, params: e } = t; return share + e.id }',
			['iris', 'params']
		]
	])
})

describe('a member call on the context returns null', () => {
	// The call passes the context as `this`, so it can read anything
	table([
		['(ctx) => ctx.me()', null],
		['(ctx) => ctx.me?.()', null],
		['(ctx) => ctx?.me()', null],
		[`(ctx) => ctx['me']()`, null],
		[`(ctx) => ctx['me']?.()`, null],
		['({ ws }) => ws.me()', null],
		// a name an allowlist would pass reads `this` all the same
		['(ctx) => ctx.params()', null]
	])
})

describe('a call that cannot read the context stays readable', () => {
	// Giving up on these would end sharing for any handler that sets a status
	table([
		['(ctx) => ctx.status(404, ctx.params.id)', ['params']],
		[`(ctx) => ctx.redirect('/')`, []],
		['(ctx) => ctx.problem({ status: 400 })', []],
		['(ws) => ws.send(ws.params.id)', ['params']],
		[`(ws) => { ws.subscribe('a'); ws.unsubscribe('a') }`, []],
		[`(ws) => { ws.publish('a', 'b'); ws.close() }`, []]
	])
})

describe('reads that must not change', () => {
	// Nothing here reaches the context through a later parameter or `this`
	table([
		['(ctx, unused) => ctx.query', ['query']],
		['(ws, message) => ws.send(message)', []],
		['({ iris }, x = iris.share) => x', ['iris']],
		['(ctx) => ctx.iris.share()', ['iris']],
		['(ctx) => ctx.me', ['me']],
		[`({ ['user']: u }) => u.name`, ['user']],
		// a comma inside the first parameter's pattern starts no later parameter
		['({ iris, ...rest }) => rest.params', ['iris', 'params', 'rest']],
		['({ params, ws }) => ws.status(404, params.id)', ['params']]
	])
})

describe('existing callers', () => {
	it('parses a channel behind a quoted key', async () => {
		const app = new Elysia().get('/', compile('({ "query": q }) => q.name'))

		const response = await app.handle('/?name=hit')
		expect(await response.text()).toBe('hit')
	})

	it('parses a channel reached by a later parameter', async () => {
		const app = new Elysia().get(
			'/',
			compile('(c = {}, d = c.query) => d.name')
		)

		const response = await app.handle('/?name=hit')
		expect(await response.text()).toBe('hit')
	})

	it('parses a channel reached by a default through arguments', async () => {
		const app = new Elysia().get(
			'/',
			compile('function({x:query=arguments[0]}){return query.query.name}')
		)

		const response = await app.handle('/?name=hit')
		expect(await response.text()).toBe('hit')
	})

	it('widens on an unnameable key', () => {
		expect(sucrose(compile('({ "query": q }) => q'), undefined)).toEqual(
			everyChannel
		)
		expect(
			sucrose(
				compile('(c) => { const { 0: a } = c; return a }'),
				undefined
			)
		).toEqual(everyChannel)
	})

	it('does not parse the channel a local is named after', () => {
		const inference = sucrose(compile('({ body: query }) => query'), {})

		expect(inference.body).toBe(true)
		expect(inference.query).toBe(false)
	})

	it('traces every phase behind a quoted key', () => {
		expect(
			unionTracePhases([compile('({ "onRequest": a }) => a()')])
		).toBeNull()
	})

	it('still narrows a trace with an unused later parameter', () => {
		expect(
			unionTracePhases([compile('({ onHandle }, unused) => onHandle()')])
		).toEqual(new Set(['handle']))
	})
})

it('exports the reader for plugins, under every condition', () => {
	expect(packageJson.exports['./sucrose']).toEqual({
		aot: './src/sucrose.ts',
		types: './dist/sucrose.d.ts',
		import: './dist/sucrose.mjs',
		require: './dist/sucrose.js'
	})
})
