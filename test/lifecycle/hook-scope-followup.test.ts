// Follow-ups to the Elysia 1 hook order and multiplicity rules
// (plugin-dedup-order.test.ts): a `.group()`/`.guard()` callback is a
// sandbox, every registration runs (no dedup by function identity), and a
// named plugin's identity is its exact name and seed.
//
// Expected results are what Elysia 1.4.30 runs for the same app, except
// where a 1.x accident is called out (a callback appending its error hooks to
// routes that already have them).

import { Elysia, t } from '../../src'
import { log, mark, named, ok, table, throwing } from './_hook-table'

table('macro hooks run per occurrence', [
	{
		// two macros sharing one hook function are two registrations
		name: 'two macro keys emitting one function',
		define: (app) => {
			const shared = mark('m')
			return app
				.macro({
					a: { beforeHandle: shared },
					b: { beforeHandle: shared }
				})
				.get('/', { a: true, b: true }, ok)
		},
		expect: { '/': '200 m,m' }
	},
	{
		name: 'a route hook and a macro emitting one function',
		define: (app) => {
			const shared = mark('m')
			return app
				.macro({ a: () => ({ afterHandle: shared }) })
				.get('/', { a: true, afterHandle: shared }, ok)
		},
		expect: { '/': '200 m,m' }
	},
	{
		// the same macro with the same value is one application (1.x seed)
		name: 'one macro reached twice with one value applies once',
		define: (app) =>
			app
				.macro({ base: { beforeHandle: mark('base') } })
				.macro({ a: { base: true }, b: { base: true } })
				.get('/', { a: true, b: true }, ok),
		expect: { '/': '200 base' }
	}
])

table('a callback keeps its hooks inside', [
	{
		// a global plugin used inside reaches the callback's routes only,
		// never the parent's later routes or a later sibling group
		name: 'global plugin used in a group callback',
		define: (app) => {
			const audit = named('audit').beforeHandle('global', mark('audit'))
			return app
				.group('/a', (g: any) => g.use(audit).get('/x', ok))
				.get('/root', ok)
				.group('/b', (g: any) => g.get('/y', ok))
		},
		expect: { '/a/x': '200 audit', '/root': '200 ', '/b/y': '200 ' }
	},
	{
		name: 'plugin and global hooks registered in a guard callback',
		define: (app) =>
			app
				.guard({}, (g: any) =>
					g
						.beforeHandle('plugin', mark('plugin'))
						.afterHandle('global', mark('global'))
						.get('/x', ok)
				)
				.get('/root', ok),
		expect: { '/x': '200 plugin,global', '/root': '200 ' }
	},
	{
		name: 'global guard schema and derive in a callback',
		define: (app) =>
			app
				.group('/a', (g: any) =>
					g
						.guard('global', { query: t.Object({ q: t.String() }) })
						.derive('global', () => ({ who: 'callback' }))
						.get('/x', ({ who }: any) => who)
				)
				.get('/root', ({ who }: any) => {
					log.push(String(who))
					return 'ok'
				}),
		expect: { '/a/x': '422 ', '/a/x?q=1': '200 ', '/root': '200 undefined' }
	},
	{
		// `request` runs before routing: a callback's lands on every request
		name: 'request hook in a callback runs for every request',
		define: (app) =>
			app
				.group('/a', (g: any) =>
					g.use(named('r').request(mark('request'))).get('/x', ok)
				)
				.get('/root', ok),
		expect: {
			'/a/x': '200 request',
			'/root': '200 request',
			'/missing': '404 request'
		}
	}
])

table("a named plugin's request hook runs once per app", [
	{
		// a factory builds a fresh instance: one installation per name
		name: 'factory plugin in a callback, then the parent',
		define: (app) => {
			const factory = () => named('r').request(mark('request'))
			return app
				.group('/a', (g: any) => g.use(factory()).get('/x', ok))
				.use(factory())
				.get('/root', ok)
		},
		expect: { '/a/x': '200 request', '/root': '200 request' }
	},
	{
		name: 'factory plugin in two callbacks and a nested plugin',
		define: (app) => {
			const factory = () => named('r').request(mark('request'))
			return app
				.group('/a', (g: any) => g.use(factory()).get('/x', ok))
				.group('/b', (g: any) => g.use(factory()).get('/y', ok))
				.use(new Elysia().use(factory()))
		},
		expect: { '/a/x': '200 request', '/missing': '404 request' }
	},
	{
		// an unnamed plugin used twice is two installations (Elysia 1)
		name: 'unnamed plugin in a callback, then the parent',
		define: (app) => {
			const plugin = new Elysia().request(mark('request'))
			return app
				.group('/a', (g: any) => g.use(plugin).get('/x', ok))
				.use(plugin)
		},
		expect: { '/a/x': '200 request,request' }
	}
])

table('a plugin a callback installed installs again outside it', [
	{
		// its routes register at the parent's path and its hooks reach
		// the parent's later routes, the error hook included
		name: 'named plugin in a group callback, then the parent',
		define: (app) => {
			const p = named('p')
				.beforeHandle('plugin', mark('pBH'))
				.error('plugin', mark('pERR'))
				.get('/p', throwing)
			return app
				.group('/a', (g: any) => g.use(p))
				.use(p)
				.get('/root', throwing)
		},
		expect: {
			'/a/p': '500 pBH,pERR',
			'/p': '500 pBH,pERR',
			'/root': '500 pBH,pERR'
		}
	},
	{
		name: 'named plugin in a callback of an unnamed plugin, then the root',
		define: (app) => {
			const p = named('p').get('/p', ok)
			return app
				.use(new Elysia().group('/w', (g: any) => g.use(p)))
				.use(p)
		},
		expect: { '/w/p': '200 ', '/p': '200 ' }
	}
])

table('callback error hooks run per registration', [
	{
		name: 'one function registered twice after the route',
		define: (app) => {
			const f = mark('f')
			return app.group('/g', (g: any) =>
				g.get('/x', throwing).error(f).error(f)
			)
		},
		expect: { '/g/x': '500 f,f' }
	},
	{
		// the route already has the one registered before it (1.x appends
		// it again, an accident)
		name: 'one registration before the route, one after',
		define: (app) => {
			const f = mark('f')
			return app.group('/g', (g: any) =>
				g.error(f).get('/x', throwing).error(f)
			)
		},
		expect: { '/g/x': '500 f,f' }
	},
	{
		name: 'the parent and the callback register one function',
		define: (app) => {
			const f = mark('f')
			return app
				.error(f)
				.group('/g', (g: any) => g.get('/x', throwing).error(f))
		},
		expect: { '/g/x': '500 f,f' }
	},
	{
		// a plugin's global error hook the route already has: its copy in
		// the callback is the same registration
		name: 'unnamed plugin with an error hook before its route',
		define: (app) => {
			const plugin = new Elysia()
				.error('global', mark('f'))
				.get('/u', throwing)
			return app.group('/g', (g: any) => g.use(plugin))
		},
		expect: { '/g/u': '500 f' }
	},
	{
		// two installations of one unnamed plugin: the parent's, and the
		// callback's after the route
		name: 'unnamed plugin used by the parent and after the route',
		define: (app) => {
			const plugin = new Elysia().error('global', mark('f'))
			return app
				.use(plugin)
				.group('/g', (g: any) => g.get('/x', throwing).use(plugin))
		},
		expect: { '/g/x': '500 f,f' }
	},
	{
		// registered after the plugin's own route: the callback covers it
		name: 'unnamed plugin with an error hook after its route',
		define: (app) => {
			const plugin = new Elysia()
				.get('/u', throwing)
				.error('global', mark('f'))
			return app.group('/g', (g: any) => g.use(plugin))
		},
		expect: { '/g/u': '500 f' }
	},
	{
		name: 'nested callbacks register one function',
		define: (app) => {
			const f = mark('f')
			return app.group('/a', (a: any) =>
				a
					.group('/b', (b: any) => b.get('/x', throwing).error(f))
					.error(f)
			)
		},
		expect: { '/a/b/x': '500 f,f' }
	}
])

const wrapper =
	(name: string) =>
	(fn: any) =>
	(...args: any[]) => {
		log.push(name)
		return fn(...args)
	}

table('wrap belongs to the plugin that registered it', [
	{
		name: 'one wrap function in two named plugins',
		define: (app) => {
			const w = wrapper('w')
			return app
				.use(named('a').wrap(w))
				.use(named('b').wrap(w))
				.get('/', ok)
		},
		expect: { '/': '200 w,w' }
	},
	{
		name: 'one named plugin reached twice',
		define: (app) => {
			const a = named('a').wrap(wrapper('w'))
			return app.use(a).use(new Elysia().use(a)).get('/', ok)
		},
		expect: { '/': '200 w' }
	},
	{
		// one registration: it belongs to the first named plugin it passes
		// through, whichever path brings it later
		name: 'one unnamed plugin through two named plugins',
		define: (app) => {
			const plugin = new Elysia().wrap(wrapper('w'))
			return app
				.use(named('a').use(plugin))
				.use(named('b').use(plugin))
				.get('/', ok)
		},
		expect: { '/': '200 w' }
	},
	{
		name: 'one unnamed plugin used directly, then through a named one',
		define: (app) => {
			const plugin = new Elysia().wrap(wrapper('w'))
			return app.use(plugin).use(named('a').use(plugin)).get('/', ok)
		},
		expect: { '/': '200 w' }
	},
	{
		// as Elysia 1, which dedups an unnamed plugin's wraps by source
		name: 'one unnamed plugin used twice',
		define: (app) => {
			const plugin = new Elysia().wrap(wrapper('w'))
			return app.use(plugin).use(plugin).get('/', ok)
		},
		expect: { '/': '200 w' }
	},
	{
		// a factory plugin builds a fresh wrap per instance, registered on
		// an unnamed instance: it belongs to the named plugin around it
		name: 'factory plugin with an unnamed inner wrap',
		define: (app) => {
			const factory = () =>
				named('n').use(new Elysia().wrap(wrapper('w')))
			return app
				.use(factory())
				.use(new Elysia().use(factory()))
				.get('/', ok)
		},
		expect: { '/': '200 w' }
	}
])

table('named plugin identity is its exact name and seed', [
	{
		// each pair shares its 32-bit fnv1a: of the bare name, of the key
		name: 'two names whose 32-bit hashes collide',
		define: (app) =>
			app
				.use(named('p1uzx').beforeHandle('global', mark('x')))
				.use(named('pc2ad').beforeHandle('global', mark('y')))
				.use(named('p1unw').beforeHandle('global', mark('z')))
				.use(named('pywba').beforeHandle('global', mark('w')))
				.get('/', ok),
		expect: { '/': '200 x,y,z,w' }
	},
	{
		name: 'a name that reads like name + seed',
		define: (app) =>
			app
				.use(named('a_1').beforeHandle('global', mark('x')))
				.use(named('a', 1).beforeHandle('global', mark('y')))
				.get('/', ok),
		expect: { '/': '200 x,y' }
	},
	{
		name: 'a falsy seed is a seed',
		define: (app) =>
			app
				.use(named('a').beforeHandle('global', mark('x')))
				.use(named('a', 0).beforeHandle('global', mark('y')))
				.use(named('a', '1').beforeHandle('global', mark('z')))
				.use(named('a', 1).beforeHandle('global', mark('w')))
				.get('/', ok),
		expect: { '/': '200 x,y,z,w' }
	},
	{
		name: 'the same name and seed install once',
		define: (app) =>
			app
				.use(named('a', { v: 1 }).beforeHandle('global', mark('x')))
				.use(named('a', { v: 1 }).beforeHandle('global', mark('y')))
				.get('/', ok),
		expect: { '/': '200 x' }
	}
])
