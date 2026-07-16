// @ts-nocheck
// `eval` preserves minified function source text.

import type { Sucrose } from '../../src/sucrose'

type Channel = keyof Sucrose.Inference
type Expect = Partial<Record<Channel, boolean>>

export interface Fixture {
	name: string
	class:
		| 'original'
		| 'minified'
		| 'rename'
		| 'nested'
		| 'default'
		| 'rest'
		| 'computed'
		| 'optional-chain'
		| 'whole-context'
		| 'method'
		| 'bound-native'
	fn: (...args: any[]) => any
	expect: Expect
	passesToday: boolean
}

function nativeShaped(this: any, c: any) {
	return c.query.a
}
const boundHandler = nativeShaped.bind({})

const objWithMethod = {
	method(c: any) {
		return c.query.a
	}
}

class ClassHandler {
	handle(c: any) {
		return c.body
	}
}

const ALL_TRUE: Expect = {
	query: true,
	body: true,
	headers: true,
	cookie: true,
	set: true,
	server: true,
	route: true,
	url: true,
	path: true
}

export const fixtures: Fixture[] = [
	{
		name: 'whole-context dot access',
		class: 'whole-context',
		fn: (c: any) => c.query.a,
		expect: { query: true },
		passesToday: true
	},
	{
		name: 'destructure single key',
		class: 'original',
		fn: ({ query }: any) => query.a,
		expect: { query: true },
		passesToday: true
	},
	{
		name: 'destructure multiple keys',
		class: 'original',
		fn: ({ query, body }: any) => log(query, body),
		expect: { query: true, body: true },
		passesToday: true
	},
	{
		name: 'route / url / path via whole context',
		class: 'whole-context',
		fn: (c: any) => log(c.url, c.path, c.route),
		expect: { url: true, route: true, path: true },
		passesToday: true
	},

	{
		name: 'minified 1-param arrow dot access',
		class: 'minified',
		fn: eval('c=>c.query.a'),
		expect: { query: true },
		passesToday: true
	},
	{
		name: 'minified destructuring-assignment alias',
		class: 'minified',
		fn: eval('c=>{const q=c.query;return sink(q)}'),
		expect: { query: true },
		passesToday: true
	},
	{
		name: 'minified two-hop alias reads body via last alias',
		class: 'minified',
		fn: eval('c=>{const a=c,b=a;return b.body}'),
		expect: { body: true },
		passesToday: true
	},
	{
		name: 'minified three-hop alias reads cookie',
		class: 'minified',
		fn: eval('c=>{const a=c,b=a,d=b;return d.cookie}'),
		expect: { cookie: true },
		passesToday: true
	},
	{
		name: 'minified body destructure-rename infers headers',
		class: 'minified',
		fn: eval('c=>{const{headers:h}=c;return sink(h)}'),
		expect: { headers: true },
		passesToday: true
	},

	{
		name: 'rename single (root param)',
		class: 'rename',
		fn: ({ query: q }: any) => opaque(q),
		expect: { query: true },
		passesToday: true
	},
	{
		name: 'rename multiple (root param)',
		class: 'rename',
		fn: ({ headers: hd, cookie: ck }: any) => opaque(hd, ck),
		expect: { headers: true, cookie: true },
		passesToday: true
	},

	{
		name: 'nested destructure query',
		class: 'nested',
		fn: ({ query: { a } }: any) => a,
		expect: { query: true },
		passesToday: true
	},
	{
		name: 'nested destructure cookie',
		class: 'nested',
		fn: ({ cookie: { auth } }: any) => auth.value,
		expect: { cookie: true },
		passesToday: true
	},

	{
		name: 'default primitive + sibling',
		class: 'default',
		fn: ({ body = 1, query }: any) => log(body, query),
		expect: { body: true, query: true },
		passesToday: true
	},
	{
		name: 'default object + sibling',
		class: 'default',
		fn: ({ headers = {}, cookie }: any) => log(headers, cookie),
		expect: { headers: true, cookie: true },
		passesToday: true
	},

	{
		name: 'rest-only destructure → all-true',
		class: 'rest',
		fn: ({ ...rest }: any) => log(rest),
		expect: ALL_TRUE,
		passesToday: true
	},

	{
		name: "computed double-quote c['query']",
		class: 'computed',
		fn: (c: any) => c['query'].a,
		expect: { query: true },
		passesToday: true
	},
	{
		name: "computed single-quote c['headers']",
		class: 'computed',
		fn: (c: any) => c['headers'],
		expect: { headers: true },
		passesToday: true
	},

	{
		name: 'optional chaining c?.query',
		class: 'optional-chain',
		fn: (c: any) => c?.query?.a,
		expect: { query: true },
		passesToday: true
	},
	{
		name: 'optional chaining c.server?.upgrade',
		class: 'optional-chain',
		fn: (c: any) => c.server?.upgrade,
		expect: { server: true },
		passesToday: true
	},

	{
		name: 'whole context passed to fn → all-true',
		class: 'whole-context',
		fn: (c: any) => log(c),
		expect: ALL_TRUE,
		passesToday: true
	},

	{
		name: 'object-method shorthand',
		class: 'method',
		fn: objWithMethod.method,
		expect: { query: true },
		passesToday: true
	},
	{
		name: 'class method',
		class: 'method',
		fn: new ClassHandler().handle,
		expect: { body: true },
		passesToday: true
	},

	{
		name: 'return body alias must not infer query',
		class: 'original',
		fn: (c: any) => {
			const b = c.body
			return b
		},
		expect: { body: true, query: false },
		passesToday: true
	},
	{
		name: 'return set alias must not infer query',
		class: 'original',
		fn: (c: any) => {
			const s = c.set
			return s
		},
		expect: { set: true, query: false },
		passesToday: true
	},

	{
		name: 'minified transitive alias retains headers',
		class: 'minified',
		fn: eval('c=>{const a=c,b=a;return b.headers}'),
		expect: { headers: true },
		passesToday: true
	},

	// Native source cannot be inspected, so all properties are required.
	{
		name: 'bound handler → all-true',
		class: 'bound-native',
		fn: boundHandler,
		expect: ALL_TRUE,
		passesToday: true
	},
	{
		name: 'native function → all-true',
		class: 'bound-native',
		fn: Array.prototype.map as any,
		expect: ALL_TRUE,
		passesToday: true
	},

	{
		name: 'dollar-prefix single-param arrow infers query',
		class: 'minified',
		fn: eval('$c=>$c.query.a'),
		expect: { query: true },
		passesToday: true
	}
]
