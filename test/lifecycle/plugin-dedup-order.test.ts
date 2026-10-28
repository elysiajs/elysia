// A named plugin (`name` + `seed`) is one plugin, however many paths bring it
// in, and each of its registrations runs once per route and event: when a
// parent absorbs a route, the route's copy of a registration is dropped if
// the parent already holds that registration's event. Everything else stays,
// in registration order: distinct hooks of one plugin, the same function
// registered twice, unnamed plugins, and a plugin's `local` hooks on its own
// routes.
//
// Expected orders are what Elysia 1.4.30 runs for the same app (each route
// given its own hook of the probed event, so 1.x array aliasing can't leak
// later hooks in). Deviations from 1.x are called out where they are pinned:
// 1.x drops every hook of a plugin's event once one arrived, Elysia 2 only
// the same registration.

import { describe, expect, it } from 'bun:test'
import { Elysia, t, type AnyElysia } from '../../src'
import { websocket } from '../../src/plugin/websocket'
import { composeRouteHook } from '../../src/compile/handler'
import { newWebsocket, wsClosed, wsMessage, wsOpen } from '../ws/utils'
import {
	lanes,
	log,
	mark,
	named,
	ok,
	table,
	throwing,
	type Case
} from './_hook-table'

const markDerive = (name: string) => () => {
	log.push(name)
	return {}
}

type Event =
	| 'transform'
	| 'derive'
	| 'beforeHandle'
	| 'afterHandle'
	| 'mapResponse'
	| 'afterResponse'
	| 'error'

// event name -> the builder method that registers it
const method = {
	transform: 'onTransform',
	derive: 'derive',
	beforeHandle: 'onBeforeHandle',
	afterHandle: 'onAfterHandle',
	mapResponse: 'mapResponse',
	afterResponse: 'onAfterResponse',
	error: 'onError'
} as const

const hookOf = (event: Event, name: string) =>
	event === 'derive' ? markDerive(name) : mark(name)

const on = (
	app: any,
	event: Event,
	name: string,
	scope: 'local' | 'plugin' | 'global' = 'local'
) => app[method[event]](scope, hookOf(event, name))

const routes = (
	app: any,
	path = '/plain',
	handler: (context: any) => unknown = ok
) => app.get(path, handler).group('/g', (g: any) => g.get('/x', handler))

// feature = F, use(audit), G; routes /plain and /g/x (inside a group)
const featureOf = (
	event: Event,
	audit: AnyElysia,
	handler: () => unknown = ok
) =>
	routes(
		on(on(named('feature'), event, 'F').use(audit), event, 'G'),
		'/plain',
		handler
	)

const auditOf = (event: Event, two = false) => {
	let audit = on(named('audit'), event, 'audit', 'global')
	if (two) audit = on(audit, event, 'audit2', 'global')
	return audit
}

const eventCases = (event: Event): Case[] => {
	const handler = event === 'error' ? throwing : ok
	const status = event === 'error' ? 500 : 200

	return [
		{
			// the parent's copy, registered between A and B, wins its
			// position; the feature's copy (and the group route's second
			// inherited copy) is dropped
			name: `${event}: root A, audit, B, use(feature)`,
			define: (app) => {
				const audit = auditOf(event)
				return on(on(app, event, 'A').use(audit), event, 'B').use(
					featureOf(event, audit, handler)
				)
			},
			expect: {
				'/plain': `${status} A,audit,B,F,G`,
				'/g/x': `${status} A,audit,B,F,G`
			},
			afterResponse: event === 'afterResponse'
		},
		{
			// two distinct hooks of one plugin are both kept, once each
			name: `${event}: two distinct audit hooks`,
			define: (app) => {
				const audit = auditOf(event, true)
				return app.use(audit).use(featureOf(event, audit, handler))
			},
			expect: {
				'/plain': `${status} audit,audit2,F,G`,
				'/g/x': `${status} audit,audit2,F,G`
			},
			afterResponse: event === 'afterResponse'
		}
	]
}

table('named plugin hook dedup per event', [
	...eventCases('beforeHandle'),
	...eventCases('transform'),
	...eventCases('derive'),
	...eventCases('afterHandle'),
	...eventCases('mapResponse'),
	...eventCases('afterResponse'),
	...eventCases('error')
])

table('named plugin use order', [
	{
		name: 'feature before the root uses audit',
		define: (app) => {
			const audit = auditOf('beforeHandle')
			return on(
				app.use(featureOf('beforeHandle', audit)).use(audit),
				'beforeHandle',
				'B'
			).get('/root', ok)
		},
		expect: {
			'/plain': '200 F,audit,G',
			'/g/x': '200 F,audit,G',
			'/root': '200 audit,B'
		}
	},
	{
		name: 'root A, use(feature), B',
		define: (app) => {
			const audit = auditOf('beforeHandle')
			return on(
				on(app, 'beforeHandle', 'A').use(
					featureOf('beforeHandle', audit)
				),
				'beforeHandle',
				'B'
			).get('/root', ok)
		},
		expect: {
			'/plain': '200 A,F,audit,G',
			'/g/x': '200 A,F,audit,G',
			'/root': '200 A,audit,B'
		}
	},
	{
		// the root's copy wins; the group callback's own `.use(audit)` and
		// the feature's are both already installed
		name: 'root audit, A; group(audit, B, use(feature))',
		define: (app) => {
			const audit = auditOf('beforeHandle')
			return on(app.use(audit), 'beforeHandle', 'A').group(
				'/api',
				(g: any) =>
					on(g.use(audit), 'beforeHandle', 'B').use(
						featureOf('beforeHandle', audit)
					)
			)
		},
		expect: {
			'/api/plain': '200 audit,A,B,F,G',
			'/api/g/x': '200 audit,A,B,F,G'
		}
	},
	{
		name: 'feature uses audit after its own hooks',
		define: (app) => {
			const audit = auditOf('beforeHandle')
			const feature = routes(
				on(
					on(named('feature'), 'beforeHandle', 'F'),
					'beforeHandle',
					'G'
				).use(audit)
			)
			return on(app, 'beforeHandle', 'A')
				.use(feature)
				.use(audit)
				.get('/late', ok)
		},
		expect: {
			'/plain': '200 A,F,G,audit',
			'/g/x': '200 A,F,G,audit',
			'/late': '200 A,audit'
		}
	},
	{
		// strict order: a parent hook added after `.use(child)` never
		// reaches the child's routes
		name: 'parent hook after use(child) never reaches it',
		define: (app) =>
			on(
				app.use(named('child').get('/c', ok)),
				'beforeHandle',
				'late'
			).get('/root', ok),
		expect: { '/c': '200 ', '/root': '200 late' }
	}
])

const shapeFeature = (audit: AnyElysia) =>
	on(named('feature'), 'beforeHandle', 'F')
		.use(audit)
		.get('/plain', ok)
		.group('/g', (g: any) =>
			g
				.get('/x', ok)
				.group('/n', (n: any) => n.get('/y', ok))
				.get('/z', ok)
		)
		.guard({ beforeHandle: mark('GD') }, (g: any) => g.get('/gc', ok))
		.guard({ beforeHandle: mark('GS') })
		.get('/after-guard', ok)

const shapePaths = (prefix: string, head: string) => ({
	[`${prefix}/plain`]: `200 ${head}`,
	[`${prefix}/g/x`]: `200 ${head}`,
	[`${prefix}/g/n/y`]: `200 ${head}`,
	[`${prefix}/g/z`]: `200 ${head}`,
	[`${prefix}/gc`]: `200 ${head},GD`,
	[`${prefix}/after-guard`]: `200 ${head},GS`
})

table('named plugin dedup across composition shapes', [
	{
		name: 'root.use(audit).use(feature)',
		define: (app) => {
			const audit = auditOf('beforeHandle')
			return app.use(audit).use(shapeFeature(audit))
		},
		expect: shapePaths('', 'audit,F')
	},
	{
		name: 'root.use(audit).group(/api, use(feature))',
		define: (app) => {
			const audit = auditOf('beforeHandle')
			return app
				.use(audit)
				.group('/api', (g: any) => g.use(shapeFeature(audit)))
		},
		expect: shapePaths('/api', 'audit,F')
	},
	{
		name: 'root.use(audit).group(/api, use(audit).use(feature))',
		define: (app) => {
			const audit = auditOf('beforeHandle')
			return app
				.use(audit)
				.group('/api', (g: any) =>
					g.use(audit).use(shapeFeature(audit))
				)
		},
		expect: shapePaths('/api', 'audit,F')
	},
	{
		name: 'nested root groups',
		define: (app) => {
			const audit = auditOf('beforeHandle')
			return app
				.use(audit)
				.group('/api', (g: any) =>
					g.group('/v1', (v: any) =>
						v.use(audit).use(shapeFeature(audit))
					)
				)
		},
		expect: shapePaths('/api/v1', 'audit,F')
	},
	{
		name: 'root.use(audit).guard({ R }, use(feature))',
		define: (app) => {
			const audit = auditOf('beforeHandle')
			return app
				.use(audit)
				.guard({ beforeHandle: mark('R') }, (g: any) =>
					g.use(shapeFeature(audit))
				)
		},
		expect: shapePaths('', 'audit,R,F')
	},
	{
		name: 'guard callback in the feature uses audit again',
		define: (app) => {
			const audit = auditOf('beforeHandle')
			const feature = named('feature')
				.get('/plain', ok)
				.guard({ beforeHandle: mark('GD') }, (g: any) =>
					g.use(audit).get('/gc', ok)
				)
			return app.use(audit).use(feature)
		},
		expect: { '/gc': '200 audit,GD', '/plain': '200 audit' }
	},
	{
		name: 'four levels deep',
		define: (app) => {
			const audit = auditOf('beforeHandle')
			const d = new Elysia()
				.use(audit)
				.group('/d', (g: any) => g.use(audit).get('/x', ok))
			const c = new Elysia().use(audit).use(d).get('/c', ok)
			return app.use(audit).use(new Elysia().use(audit).use(c))
		},
		expect: { '/d/x': '200 audit', '/c': '200 audit' }
	},
	{
		name: 'named global guard with two hooks',
		define: (app) => {
			const guard = named('guard').guard('global', {
				beforeHandle: [mark('g1'), mark('g2')]
			})
			const feature = routes(new Elysia().use(guard), '/child')
			return app.use(guard).use(feature).get('/root', ok)
		},
		expect: {
			'/child': '200 g1,g2',
			'/g/x': '200 g1,g2',
			'/root': '200 g1,g2'
		}
	},
	{
		name: '.as(global) promoted hook',
		define: (app) => {
			const promoted = on(named('promoted'), 'beforeHandle', 'asp').as(
				'global'
			)
			const feature = routes(new Elysia().use(promoted), '/child')
			return app.use(promoted).use(feature).get('/root', ok)
		},
		expect: { '/child': '200 asp', '/g/x': '200 asp', '/root': '200 asp' }
	}
])

table('named plugin scopes', [
	...(['plugin', 'global'] as const).flatMap((scope): Case[] => [
		{
			name: `${scope}: root.use(P).use(feature.use(P))`,
			define: (app) => {
				const p = on(named('P'), 'beforeHandle', 'P', scope).get(
					'/p',
					ok
				)
				const feature = routes(named('feature').use(p))
				return app.use(p).use(feature).get('/root', ok)
			},
			expect: {
				'/p': '200 P',
				'/plain': '200 P',
				'/g/x': '200 P',
				'/root': '200 P'
			}
		},
		{
			name: `${scope}: root.use(P).use(Q.use(R.use(P)))`,
			define: (app) => {
				const p = on(named('P'), 'beforeHandle', 'P', scope)
				const r = named('R')
					.use(p)
					.get('/r', ok)
					.group('/rg', (g: any) => g.get('/x', ok))
				return app.use(p).use(named('Q').use(r))
			},
			expect: { '/r': '200 P', '/rg/x': '200 P' }
		}
	]),
	{
		// X's plugin-scoped beforeHandle reaches Y's routes (Y used X
		// directly) even though the root only holds X's global afterHandle:
		// installation is per lifecycle event
		name: 'outer layer holds another event of the same plugin',
		define: (app) => {
			const x = () =>
				on(
					on(named('X'), 'beforeHandle', 'XE', 'plugin'),
					'afterHandle',
					'XF',
					'global'
				)
			const y = new Elysia()
				.use(x())
				.get('/y', ok)
				.group('/g', (g: any) => g.get('/y', ok))
			return app.use(new Elysia().use(new Elysia().use(x()))).use(y)
		},
		expect: { '/y': '200 XE,XF', '/g/y': '200 XE,XF' }
	}
])

// one feature chain, flattened once per set of plugins its parent installed
const sharedFeature = () => {
	const p = on(named('P'), 'beforeHandle', 'P', 'plugin')
	const q = on(named('Q'), 'beforeHandle', 'Q', 'plugin')
	return { p, q, feature: new Elysia().use(p).use(q).get('/f', ok) }
}

table('one plugin instance under parents installing different plugins', [
	{
		name: 'two groups',
		define: (app) => {
			const { p, q, feature } = sharedFeature()
			return app
				.group('/a', (g: any) => g.use(p).use(feature))
				.group('/b', (g: any) => g.use(q).use(feature))
		},
		expect: { '/a/f': '200 P,Q', '/b/f': '200 Q,P' }
	},
	{
		name: 'two prefixed plugins',
		define: (app) => {
			const { p, q, feature } = sharedFeature()
			return app
				.use(new Elysia({ prefix: '/a' }).use(p).use(feature))
				.use(new Elysia({ prefix: '/b' }).use(q).use(feature))
		},
		expect: { '/a/f': '200 P,Q', '/b/f': '200 Q,P' }
	}
])

table('seeded and factory plugins', [
	// a factory makes a new closure per call; name + seed is the identity
	...(
		[
			[1, 'P:1'],
			[2, 'P:1,P:2']
		] as const
	).map(
		([seed, out]): Case => ({
			name: `factory, ${seed === 1 ? 'same' : 'different'} seed`,
			define: (app) => {
				const factory = (n: number) =>
					on(named('seeded', n), 'beforeHandle', `P:${n}`, 'global')
				const feature = routes(new Elysia().use(factory(seed)))
				return app.use(factory(1)).use(feature)
			},
			expect: { '/plain': `200 ${out}`, '/g/x': `200 ${out}` }
		})
	),
	{
		name: 'same name, different content: first install wins',
		define: (app) => {
			const first = on(named('cfg'), 'beforeHandle', 'first', 'global')
			const second = on(named('cfg'), 'beforeHandle', 'second', 'global')
			const feature = routes(new Elysia().use(second))
			return app.use(first).use(feature)
		},
		expect: { '/plain': '200 first', '/g/x': '200 first' }
	},
	{
		// one function, two distinct plugins: two installations
		name: 'shared function, different seeds',
		define: (app) => {
			const shared = mark('shared')
			const factory = (seed: number) =>
				named('s', seed).onBeforeHandle('global', shared)
			const feature = routes(new Elysia().use(factory(2)))
			return app.use(factory(1)).use(feature)
		},
		expect: {
			'/plain': '200 shared,shared',
			'/g/x': '200 shared,shared'
		}
	}
])

table('multiplicity Elysia 1 keeps', [
	{
		name: 'same function registered twice, diamond',
		define: (app) => {
			const same = mark('same')
			const audit = named('audit')
				.onBeforeHandle('global', same)
				.onBeforeHandle('global', same)
			const feature = routes(new Elysia().use(audit), '/child')
			return app.use(audit).use(feature).get('/root', ok)
		},
		expect: {
			'/child': '200 same,same',
			'/g/x': '200 same,same',
			'/root': '200 same,same'
		}
	},
	{
		name: 'same function local and global on its own routes',
		define: (app) => {
			const both = mark('both')
			const plugin = routes(
				named('scope')
					.onBeforeHandle('local', both)
					.onBeforeHandle('global', both),
				'/child'
			)
			return app.use(plugin).get('/root', ok)
		},
		expect: {
			'/child': '200 both,both',
			'/g/x': '200 both,both',
			'/root': '200 both'
		}
	},
	{
		// maintainer decision: unnamed plugins run once per path, as in 1.x
		name: 'unnamed plugin used by the root and a feature',
		define: (app) => {
			const anon = new Elysia().onBeforeHandle('global', mark('anon'))
			const feature = routes(new Elysia().use(anon), '/child')
			return app.use(anon).use(feature).get('/root', ok)
		},
		expect: {
			'/child': '200 anon,anon',
			'/g/x': '200 anon,anon',
			'/root': '200 anon,anon'
		}
	},
	{
		name: 'named plugin hook function also registered on the root',
		define: (app) => {
			const shared = mark('shared')
			const audit = named('audit').onBeforeHandle('global', shared)
			const feature = routes(new Elysia().use(audit))
			return app.onBeforeHandle(shared).use(feature).get('/root', ok)
		},
		expect: {
			'/plain': '200 shared,shared',
			'/g/x': '200 shared,shared',
			'/root': '200 shared,shared'
		}
	},
	{
		// an unnamed helper takes the first named plugin it passes through
		name: 'unnamed helper re-exported by a named plugin',
		define: (app) => {
			const helper = new Elysia().onBeforeHandle('global', mark('helper'))
			const auth = named('auth')
				.use(helper)
				.onBeforeHandle('global', mark('auth'))
			const feature = routes(new Elysia().use(auth), '/child')
			return app.use(auth).use(feature).get('/root', ok)
		},
		expect: {
			'/child': '200 helper,auth',
			'/g/x': '200 helper,auth',
			'/root': '200 helper,auth'
		}
	}
])

table('registration order and macros', [
	{
		// propagation used to emit global nodes before plugin ones
		name: 'plugin, global, plugin keep registration order',
		define: (app) =>
			app
				.use(
					on(
						on(
							on(named('mix'), 'beforeHandle', 'P1', 'plugin'),
							'beforeHandle',
							'G1',
							'global'
						),
						'beforeHandle',
						'P2',
						'plugin'
					)
				)
				.get('/root', ok),
		expect: { '/root': '200 P1,G1,P2' }
	},
	{
		// propagation used to merge both guards into one object, last wins
		name: 'two global guards with the same macro key',
		define: (app) => {
			const roles = named('roles')
				.macro({
					role: (role: string) => ({
						beforeHandle: mark(`role:${role}`)
					})
				})
				.guard('global', { role: 'a' })
				.guard('global', { role: 'b' })
			return app.use(roles).get('/root', ok)
		},
		expect: { '/root': '200 role:a,role:b' }
	},
	{
		name: 'macro applied by a named global guard, diamond',
		define: (app) => {
			const auth = named('auth')
				.macro({ auth: { beforeHandle: mark('macroAuth') } })
				.guard('global', { auth: true })
			const feature = routes(new Elysia().use(auth), '/child')
			return app.use(auth).use(feature).get('/root', ok)
		},
		expect: {
			'/child': '200 macroAuth',
			'/g/x': '200 macroAuth',
			'/root': '200 macroAuth'
		}
	},
	{
		// a merge guard is copied on every `.use()` (its `schema` mode stays
		// behind); the copy is still the same registration
		name: 'macro in a named global merge guard, diamond',
		define: (app) => {
			const auth = named('auth')
				.macro({ auth: { beforeHandle: mark('macroAuth') } })
				.guard('global', {
					schema: 'merge',
					query: t.Object({ q: t.Optional(t.String()) }),
					auth: true
				})
			const feature = routes(new Elysia().use(auth), '/child')
			return app.use(auth).use(feature).get('/root', ok)
		},
		expect: {
			'/child': '200 macroAuth',
			'/g/x': '200 macroAuth',
			'/root': '200 macroAuth'
		}
	},
	{
		name: 'function macro applied by a named global guard, diamond',
		define: (app) => {
			const auth = named('auth')
				.macro({ auth: () => ({ beforeHandle: mark('macroFn') }) })
				.guard('global', { auth: true })
			const feature = routes(new Elysia().use(auth), '/child')
			return app.use(auth).use(feature).get('/root', ok)
		},
		expect: {
			'/child': '200 macroFn',
			'/g/x': '200 macroFn',
			'/root': '200 macroFn'
		}
	}
])

table('plugin local hooks and callback errors', [
	{
		// P's route comes in twice; the copy that serves keeps P's local hook,
		// which Elysia 1 drops (same checksum as P's global hook). The outer
		// copy of the global hook keeps its position, so it runs first
		name: "re-emitted plugin route keeps the plugin's local hook",
		define: (app) => {
			const p = named('P')
				.onBeforeHandle(mark('Plocal'))
				.onBeforeHandle('global', mark('Pglobal'))
				.get('/p', ok)
			return app.use(p).use(new Elysia().use(p))
		},
		expect: { '/p': '200 Pglobal,Plocal' }
	},
	{
		name: 'named error hook at the root and in a group callback',
		define: (app) => {
			const audit = () => named('audit').onError('global', mark('audit'))
			return app
				.use(audit())
				.group('/g', (g: any) =>
					g.get('/x', throwing).use(audit()).get('/y', throwing)
				)
		},
		expect: { '/g/x': '500 audit', '/g/y': '500 audit' }
	},
	{
		// the callback's own error hook still covers the route before it
		name: 'callback error hook with a named global error hook',
		define: (app) => {
			const audit = named('audit').onError('global', mark('audit'))
			const feature = named('feature')
				.use(audit)
				.get('/plain', throwing)
				.group('/g', (g: any) =>
					g.get('/x', throwing).onError(mark('cb'))
				)
			return app.use(audit).use(feature)
		},
		expect: { '/g/x': '500 audit,cb', '/plain': '500 audit' }
	},
	{
		// a callback's audit stays inside it: the feature's own
		// installation brings both of its hooks
		name: 'feature keeps an error hook the outer copy lacks',
		define: (app) => {
			const audit = () =>
				named('audit')
					.onBeforeHandle('global', mark('auditBH'))
					.onError('global', mark('auditERR'))
			const feature = new Elysia().use(audit()).get('/f', throwing)
			return app
				.group('/api', (g: any) => g.use(audit()).get('/x', throwing))
				.use(feature)
		},
		expect: {
			'/api/x': '500 auditBH,auditERR',
			'/f': '500 auditBH,auditERR'
		}
	}
])

table('derive, schemas and late registrations', [
	{
		// derive and beforeHandle are different lifecycle events: the root
		// holding X's beforeHandle must not erase X's derive
		name: 'derive survives an outer copy of the same plugin beforeHandle',
		define: (app) => {
			const x = () =>
				named('X')
					.derive('plugin', () => {
						log.push('derive')
						return { needed: 'present' }
					})
					.onBeforeHandle('global', mark('beforeHandle'))
			const child = new Elysia().use(x()).get('/x', ({ needed }: any) => {
				log.push(needed ?? 'MISSING')
				return 'ok'
			})
			return app.use(new Elysia().use(new Elysia().use(x()))).use(child)
		},
		expect: { '/x': '200 beforeHandle,derive,present' }
	},
	{
		name: 'beforeHandle added later survives an outer copy of the derive',
		define: (app) => {
			const audit = named('late-before').derive(
				'global',
				markDerive('derive')
			)
			const root = app.use(audit)
			audit.onBeforeHandle('global', mark('late-before'))
			const feature = named('feature').use(audit).get('/plain', ok)
			return root.use(feature)
		},
		expect: { '/plain': '200 derive,late-before' }
	},
	{
		name: 'derive added later survives an outer copy of the beforeHandle',
		define: (app) => {
			const audit = named('late-derive').onBeforeHandle(
				'global',
				mark('before')
			)
			const root = app.use(audit)
			audit.derive('global', () => {
				log.push('derive')
				return { needed: 1 }
			})
			const handler = ({ needed }: any) => {
				log.push(`handler:${needed}`)
				return 'ok'
			}
			const feature = routes(
				named('feature').use(audit),
				'/plain',
				handler
			)
			return root.use(feature)
		},
		expect: {
			'/plain': '200 before,derive,handler:1',
			'/g/x': '200 before,derive,handler:1'
		}
	}
])

describe('schemas are never deduplicated', () => {
	for (const lane of lanes) {
		it(`an outer header schema keeps the inner query schema (${lane.id})`, async () => {
			const plugin = () =>
				named('schemas')
					.guard('plugin', {
						schema: 'merge',
						query: t.Object({ required: t.String() })
					})
					.guard('global', {
						schema: 'merge',
						headers: t.Object({ 'x-required': t.String() })
					})
			const instance = await lane.make((app) =>
				app
					.use(new Elysia().use(new Elysia().use(plugin())))
					.use(new Elysia().use(plugin()).get('/x', ok))
			)
			try {
				const status = async (
					path: string,
					headers: Record<string, string>
				) =>
					(
						await instance.handle(
							new Request(`http://localhost${path}`, { headers })
						)
					).status

				expect(await status('/x', { 'x-required': 'yes' })).toBe(422)
				expect(
					await status('/x?required=yes', { 'x-required': 'yes' })
				).toBe(200)
				expect(await status('/x?required=yes', {})).toBe(422)
			} finally {
				await instance.dispose()
			}
		})
	}
})

table('schemas are never deduplicated', [
	{
		name: 'a global guard added to an installed plugin reaches later routes',
		define: (app) => {
			const audit = named('audit').onBeforeHandle('global', () => {})
			const root = app.use(audit)
			audit.guard('global', {
				query: t.Object({ token: t.String() })
			})
			const feature = named('feature').use(audit).get('/feature', ok)
			return root.use(feature).get('/root', ok)
		},
		expect: { '/feature': '422 ', '/root': '422 ', '/root?token=a': '200 ' }
	},
	{
		name: 'a later global header guard reaches later routes',
		define: (app) => {
			const audit = named('audit').guard('global', {
				query: t.Object({ token: t.String() })
			})
			const root = app.use(audit)
			audit.guard('global', {
				headers: t.Object({ 'x-required': t.String() })
			})
			const feature = routes(named('feature').use(audit), '/feature')
			return root.use(feature).get('/root', ok)
		},
		expect: {
			'/feature?token=ok': '422 ',
			'/g/x?token=ok': '422 ',
			'/root?token=ok': '422 '
		}
	}
])

// Users may pass one object or function to many registrations; an
// installation is a registration, never the object it was given
table('reused objects are separate registrations', [
	...[false, true].map(
		(fresh): Case => ({
			name: `one guard object reused by two plugins${fresh ? ' (fresh copy control)' : ''}`,
			define: (app) => {
				const definition = { check: { beforeHandle: mark('check') } }
				const registration = { check: true, schema: 'merge' as const }
				const q = named('Q').macro(definition)
				const root = app
					.use(
						named('P')
							.macro(definition)
							.guard('global', registration)
					)
					.use(q)
				q.guard('global', fresh ? { ...registration } : registration)

				return root.use(new Elysia().use(q)).get('/root', ok)
			},
			expect: { '/root': '200 check,check' }
		})
	),
	{
		name: 'one guard object, two plugins, the second registered late',
		define: (app) => {
			const definition = { foo: { beforeHandle: mark('macro') } }
			const h = { foo: true }
			const q = named('Q').macro(definition)
			const root = app
				.use(named('P').macro(definition).guard('global', h))
				.use(q)
			q.guard('global', h)
			const feature = new Elysia().use(q).get('/feature', ok)

			return root.use(feature).get('/root', ok)
		},
		expect: { '/feature': '200 macro,macro', '/root': '200 macro,macro' }
	},
	{
		// one unnamed registration reaching the root through two named
		// plugins is two installations
		name: 'unnamed helper used by two named plugins, the second late',
		define: (app) => {
			const helper = new Elysia().onBeforeHandle('global', mark('helper'))
			const auth2 = named('auth2')
			const root = app.use(named('auth1').use(helper)).use(auth2)
			auth2.use(helper)
			const feature = new Elysia().use(auth2).get('/f', ok)

			return root.use(feature).get('/root', ok)
		},
		expect: { '/f': '200 helper,helper', '/root': '200 helper,helper' }
	},
	{
		name: 'one guard object registered twice by a plugin, diamond',
		define: (app) => {
			const g = { beforeHandle: mark('g') }
			const p = named('P').guard('global', g).guard('global', g)
			const feature = new Elysia().use(p).get('/child', ok)

			return app.use(p).use(feature).get('/root', ok)
		},
		expect: { '/child': '200 g,g', '/root': '200 g,g' }
	},
	{
		name: 'one function in two plugins',
		define: (app) => {
			const fn = mark('fn')
			const feature = new Elysia()
				.use(named('Q').onBeforeHandle('global', fn))
				.get('/f', ok)

			return app.use(named('P').onBeforeHandle('global', fn)).use(feature)
		},
		expect: { '/f': '200 fn,fn' }
	},
	{
		name: 'one function as derive and beforeHandle in two registrations, diamond',
		define: (app) => {
			const fn = markDerive('fn')
			const p = named('P')
				.derive('global', fn)
				.onBeforeHandle('global', fn)
			const feature = new Elysia().use(p).get('/child', ok)

			return app.use(p).use(feature).get('/root', ok)
		},
		expect: { '/child': '200 fn,fn', '/root': '200 fn,fn' }
	},
	...(['beforeHandle', 'error'] as const).map(
		(event): Case => ({
			// a registration of no hooks installs nothing
			name: `empty ${event} array`,
			define: (app) => {
				const feature = new Elysia()
					.use(named('empty')[method[event]]('global', mark('kept')))
					.get('/x', event === 'error' ? throwing : ok)

				return app
					.use(named('empty')[method[event]]('global', []))
					.use(feature)
			},
			expect: { '/x': `${event === 'error' ? 500 : 200} kept` }
		})
	)
])

table('derive occurrences across layers', [
	{
		// the root's plain beforeHandle and the feature's derive are one
		// function; each occurrence keeps its own role, so the derive's
		// object is merged into context instead of becoming the response
		name: 'outer beforeHandle and inner derive of one function',
		define: (app) => {
			const shared = (c: any) => {
				log.push(`shared:${Boolean(c.flag)}`)
				if (c.flag) return { unexpected: true }
			}
			const feature = new Elysia()
				.onBeforeHandle((c: any) => {
					log.push('prepare')
					c.flag = true
				})
				.use(named('X').derive('global', shared))
				.onBeforeHandle(mark('after'))
				.get('/x', () => {
					log.push('handler')
					return 'ok'
				})

			return app
				.use(named('X').onBeforeHandle('global', shared))
				.use(feature)
		},
		expect: { '/x': '200 shared:false,prepare,shared:true,after,handler' }
	},
	{
		name: 'outer derive and inner beforeHandle of one function',
		define: (app) => {
			const shared = (c: any) => {
				log.push(`shared:${Boolean(c.flag)}`)
				if (c.flag) return { early: true }
				return {}
			}
			const feature = new Elysia()
				.onBeforeHandle((c: any) => {
					log.push('prepare')
					c.flag = true
				})
				.use(named('X').onBeforeHandle('global', shared))
				.get('/x', () => {
					log.push('handler')
					return 'ok'
				})

			return app.use(named('X').derive('global', shared)).use(feature)
		},
		expect: { '/x': '200 shared:false,prepare,shared:true' }
	}
])

describe('a schema reached through two paths validates on each', () => {
	for (const lane of lanes)
		it(`repeats the merge schema (${lane.id})`, async () => {
			let validations = 0
			const query = {
				'~standard': {
					version: 1,
					vendor: 'probe',
					validate(value: any) {
						validations++
						return { value: { ...value, passes: validations } }
					}
				}
			}
			const instance = await lane.make((app) => {
				const p = named('P').guard('global', { schema: 'merge', query })
				return app
					.use(new Elysia().use(p))
					.use(new Elysia().use(p))
					.get('/', ({ query }: any) => query)
			})

			try {
				validations = 0
				const response = await instance.handle(
					new Request('http://localhost/')
				)
				expect([
					response.status,
					await response.json(),
					validations
				]).toEqual([200, { passes: 2 }, 2])
			} finally {
				await instance.dispose()
			}
		})
})

table('one function as derive and beforeHandle in one guard', [
	{
		// an outer derive installation of X drops only the derive one
		name: 'keeps the beforeHandle occurrence',
		define: (app) => {
			const shared = markDerive('shared')
			const feature = new Elysia()
				.use(
					named('X').guard('global', {
						derive: shared,
						beforeHandle: shared
					})
				)
				.get('/x', ok)

			return app
				.use(named('X').derive('global', markDerive('outer-derive')))
				.use(feature)
		},
		expect: { '/x': '200 {} outer-derive,shared' },
		body: true
	}
])

// its return value is the response, not merged into context. Elysia 1
// responds the same, after running the derive first, in transform
const sharedUser = (c: any) => {
	log.push(`shared:${c.user ?? '-'}`)
	return { user: 'alice' }
}
const userHandler = ({ user }: any) => {
	log.push(`handler:${user}`)
	return 'handler'
}

table('a plain occurrence ahead of a derive of the same function', [
	{
		name: 'in one guard responds early',
		define: (app) =>
			app.guard({ beforeHandle: sharedUser }, (g: any) =>
				g.derive(sharedUser).get('/x', userHandler)
			),
		expect: { '/x': '200 {"user":"alice"} shared:-' },
		body: true
	},
	{
		name: 'outer beforeHandle, inner derive responds early',
		define: (app) =>
			app
				.use(named('X').onBeforeHandle('global', sharedUser))
				.use(
					new Elysia()
						.use(named('X').derive('global', sharedUser))
						.get('/x', userHandler)
				),
		expect: { '/x': '200 {"user":"alice"} shared:-' },
		body: true
	}
])

// resolving it registers a macro on another app, which drops every memo:
// what the route's chain installs must outlive that, or the named
// plugin's hook runs again in the route's own chain
const other = new Elysia()

table('a macro that moves the macro epoch while it resolves', [
	{
		name: "runs the named plugin's macro hook once",
		define: (app) => {
			const plugin = named('epoch')
				.macro({
					m: () => {
						other.macro({ unused: {} })
						return { beforeHandle: mark('macro') }
					}
				})
				.guard('global', { m: true })

			return app.use(plugin).use(new Elysia().use(plugin).get('/p', ok))
		},
		expect: { '/p': '200 macro' }
	}
])

// A named plugin installed by a child first, then `.use()`d by the parent
// itself: the parent gets the registrations the child did not pass on (its
// `plugin` scope ones), once each. Elysia 1.4 dropped them when the same
// plugin's global hook of that event had already arrived (fail-open)
const authOf = (name = 'auth') =>
	named(name)
		.onBeforeHandle('global', mark('log'))
		.derive('plugin', () => {
			log.push('derive')
			return { user: undefined }
		})
		.onBeforeHandle('plugin', ({ user, status }: any) => {
			log.push('gate')
			if (!user) return status(401)
		})

table('a named plugin installed below, then directly', [
	{
		name: 'plugin-scope gate and derive cover the parent route',
		define: (app) => {
			const auth = authOf()
			return app
				.use(new Elysia().use(auth).get('/feature', ok))
				.use(auth)
				.get('/admin', ok)
		},
		expect: {
			'/feature': '401 log,derive,gate',
			'/admin': '401 log,derive,gate'
		}
	},
	{
		name: 'an identically built instance (same name) does the same',
		define: (app) =>
			app
				.use(new Elysia().use(authOf()).get('/feature', ok))
				.use(authOf())
				.get('/admin', ok),
		expect: {
			'/feature': '401 log,derive,gate',
			'/admin': '401 log,derive,gate'
		}
	},
	{
		name: 'plugin-scope guard schema covers the parent route',
		define: (app) => {
			const p = named('query-guard').guard('plugin', {
				query: t.Object({ q: t.String() })
			})
			return app.use(new Elysia().use(p)).use(p).get('/admin', ok)
		},
		expect: { '/admin?q=1': '200 ', '/admin': '422 ' }
	},
	{
		// item 6: the global hook of the same event arrived first
		name: 'a global hook of the same event does not shadow the gate',
		define: (app) => {
			const auth = named('shadow')
				.onBeforeHandle('global', mark('log'))
				.onBeforeHandle('plugin', ({ status }: any) => {
					log.push('gate')
					return status(401)
				})
			return app
				.use(new Elysia().use(auth).get('/feature', ok))
				.use(auth)
				.get('/admin', ok)
		},
		expect: { '/feature': '401 log,gate', '/admin': '401 log,gate' }
	},
	{
		// the parent's chain ends in the plugin's own order, so the global
		// hook sees the derive it was declared after; a route registered
		// before the direct use keeps what it had
		name: "restores the plugin's order",
		define: (app) => {
			const p = named('ordered')
				.derive('plugin', () => {
					log.push('derive')
					return { user: 'dana' }
				})
				.onBeforeHandle('global', ({ user }: any) => {
					log.push(`global:${user}`)
				})
			return app
				.use(new Elysia().use(p).get('/child', ok))
				.get('/before', ok)
				.use(p)
				.get('/admin', ok)
		},
		expect: {
			'/child': '200 derive,global:dana',
			'/before': '200 global:undefined',
			'/admin': '200 derive,global:dana'
		}
	},
	{
		// a `macro` the plugin defined after the child had it is added, so
		// a guard using it gates
		name: 'a late macro and guard of the plugin',
		define: (app) => {
			const p = named('late-macro').onBeforeHandle('global', mark('g'))
			const root = app.use(new Elysia().use(p))
			p.macro({
				gate: {
					beforeHandle({ status }: any) {
						log.push('gate')
						return status(401)
					}
				}
			}).guard('plugin', { gate: true })

			return root.use(p).get('/', ok)
		},
		expect: { '/': '401 g,gate' }
	},
	{
		// a group lifts only the `request` part of a guard; a later direct
		// use still installs the rest
		name: 'a guard with request and beforeHandle lifted by a group',
		define: (app) => {
			const p = named('lift-mixed').guard('global', {
				request: mark('req'),
				beforeHandle: mark('bh')
			} as any)
			return app
				.group('/g', (g: any) => g.use(p).get('/', ok))
				.use(p)
				.get('/', ok)
		},
		expect: { '/': '200 req,bh' }
	}
])

// Same-name instances (D1) are one plugin: their registrations correspond by
// the order the instance exported them
table('registration identity of same-name instances', [
	{
		// an empty exported registration takes no ordinal
		name: 'an empty exported guard does not shift the next hook',
		define: (app) => {
			const make = (empty: boolean) => {
				let p = named('empty-export', 'S')
				if (empty) p = p.guard('plugin', {})
				return p.onBeforeHandle('global', mark(empty ? 'A' : 'B'))
			}
			return app
				.use(named('ew-a').use(make(true)))
				.use(named('ew-b').use(make(false)))
				.get('/', ok)
		},
		expect: { '/': '200 A' }
	},
	...(['own-first', 'imported-first'] as const).flatMap((order): Case[] => {
		const build = (app: any, path: string) => {
			const same = mark('same')
			const twin = named('twin', 'S').onBeforeHandle('global', same)
			let x = named('twin', 'S')
			x =
				order === 'own-first'
					? x.onBeforeHandle('global', same).use(twin)
					: x.use(twin).onBeforeHandle('global', same)
			return path === '/'
				? x.get('/', ok)
				: x.use(new Elysia().get('/c', ok))
		}
		return [
			{
				// one registration in one layer, own and imported
				name: `own and imported twin, ${order}`,
				define: (app) => app.use(build(app, '/')),
				expect: { '/': '200 same' }
			},
			{
				// same, on a child route: the compact beforeHandle lane
				name: `own and imported twin, ${order}, child route`,
				define: (app) => app.use(build(app, '/c')),
				expect: { '/c': '200 same' }
			}
		]
	}),
	{
		// a re-copied registration in a group callback: its error hook runs
		// once
		name: 'callback error hook re-copied by a direct use',
		define: (app) => {
			const p = named('cb-order')
				.derive('plugin', () => {
					log.push('derive')
					return {}
				})
				.onError('global', mark('err'))
			return app.group('/g', (g: any) =>
				g.use(new Elysia().use(p)).use(p).get('/x', throwing)
			)
		},
		expect: { '/g/x': '500 derive,err' }
	},
	{
		// an empty request array takes no once-per-app request slot
		name: 'an empty request array, then a real one',
		define: (app) =>
			app
				.use(new Elysia().use(named('empty-request').onRequest([])))
				.use(
					new Elysia().use(
						named('empty-request').onRequest(mark('request'))
					)
				)
				.get('/', ok),
		expect: { '/': '200 request' }
	}
])

describe('a plugin seen below, then used directly, with macros', () => {
	const make = () =>
		named('macro-conflict')
			.macro({ auth: { beforeHandle: mark('plugin-auth') } })
			.guard('plugin', { auth: true })

	it('rejects a macro the parent redefined since, as a fresh use does', () => {
		const p = make()
		const root = new Elysia().use(new Elysia().use(p))
		root.macro({ auth: { beforeHandle: mark('root-auth') } })

		expect(() => root.use(p)).toThrow(
			'Macro "auth" can be only define once'
		)
		// still seen below only: a retry is checked again, not skipped
		expect(() => root.use(p)).toThrow(
			'Macro "auth" can be only define once'
		)
		expect(() =>
			new Elysia()
				.macro({ auth: { beforeHandle: mark('root-auth') } })
				.use(make())
		).toThrow('Macro "auth" can be only define once')
	})

	it('accepts the same plugin, and an identically built instance', async () => {
		const root = new Elysia()
			.use(new Elysia().use(make()))
			.use(make())
			.get('/', ok)

		log.length = 0
		await root.handle(new Request('http://localhost/'))
		expect(log).toEqual(['plugin-auth'])
	})
})

describe('same-name variants with different hooks', () => {
	const capture = async (build: () => unknown) => {
		const original = console.warn
		const warnings: string[] = []
		console.warn = (message: string) => {
			warnings.push(message)
		}
		try {
			build()
		} finally {
			console.warn = original
		}
		return warnings
	}

	it('warns once in development when a variant is skipped', async () => {
		const warnings = await capture(() =>
			new Elysia()
				.use(
					named('variant-a').use(
						named('variant-warn').onBeforeHandle(
							'global',
							() => 'a'
						)
					)
				)
				.use(
					named('variant-b').use(
						named('variant-warn').onBeforeHandle(
							'global',
							() => 'b'
						)
					)
				)
				.use(
					named('variant-c').use(
						named('variant-warn').onBeforeHandle(
							'global',
							() => 'c'
						)
					)
				)
		)

		expect(warnings).toHaveLength(1)
		expect(warnings[0]).toContain('give each variant its own seed')
	})

	it('stays quiet for identically built instances', async () => {
		const make = () =>
			named('variant-same').onBeforeHandle('global', () => 'same')
		const warnings = await capture(() =>
			new Elysia()
				.use(named('same-a').use(make()))
				.use(named('same-b').use(make()))
		)

		expect(warnings).toEqual([])
	})
})

describe('repeated admitting uses of same-name variants', () => {
	// each variant's new registration comes first, so restoring the order
	// would copy every older one again: a twin is not re-copied, and the
	// root chain stays linear in the registrations it holds
	it('keeps the receiver chain linear', async () => {
		const n = 64
		let calls = 0
		const root = new Elysia()
		for (let m = 1; m <= n; m++) {
			const p = named('variant')
			for (let i = 0; i < m; i++)
				p.onBeforeHandle(() => {
					calls++
				})
			p.as('global')
			root.use(new Elysia().use(p))
		}

		let nodes = 0
		for (let node = (root as any)['~hookChain']; node; node = node.parent)
			nodes++
		expect(nodes).toBe(n)

		await root.get('/', ok).handle(new Request('http://localhost/'))
		expect(calls).toBe(n)
	})
})

describe('scope promotion after reading routes', () => {
	// `.as()` changes which hooks count as installed; anything cached from
	// an earlier read must not survive it. Root and child share a name, so
	// root's A, exported by `.as()`, is the same registration as B (D1)
	for (const warm of [false, true])
		it(`root.as(global) applies the same with ${warm ? 'a warm' : 'a cold'} cache`, async () => {
			const root = named('X').onBeforeHandle(mark('A'))
			const child = named('X')
				.onBeforeHandle('global', mark('B'))
				.get('/x', ok)
			root.use(child)
			if (warm) void root.routes
			root.as('global')

			log.length = 0
			const response = await root.handle(
				new Request('http://localhost/x')
			)
			expect(`${response.status} ${log.join(',')}`).toBe('200 A')
		})
})

describe('route introspection and WebSocket upgrades', () => {
	const diamond = (app: AnyElysia) => {
		const audit = auditOf('beforeHandle')
		return on(
			on(app, 'beforeHandle', 'A').use(audit),
			'beforeHandle',
			'B'
		).use(
			on(
				on(named('feature'), 'beforeHandle', 'F').use(audit),
				'beforeHandle',
				'G'
			)
				.ws('/plain', { message() {} })
				.group('/g', (g: any) =>
					g.ws('/x', { message() {} }).get('/http', ok)
				)
		)
	}

	it('app.routes lists each hook once', () => {
		const app = diamond(new Elysia().use(websocket()))
		const route = app.routes.find((r) => r.path === '/g/http')!

		log.length = 0
		for (const fn of [].concat(route.hooks.beforeHandle)) (fn as any)({})
		expect(log).toEqual(['A', 'audit', 'B', 'F', 'G'])
	})

	it('keeps a plain occurrence of a derived function per message', async () => {
		// the derive runs at the upgrade only, the beforeHandle on each message
		const shared = mark('shared')
		const app = new Elysia()
			.use(websocket())
			.guard({ derive: shared, beforeHandle: shared }, (g: any) =>
				g.ws('/ws', {
					message(ws: any, message: unknown) {
						ws.send(message)
					}
				})
			)
			.listen(0)

		try {
			log.length = 0
			const ws = newWebsocket(app.server!, '/ws')
			await wsOpen(ws)
			expect(log).toEqual(['shared', 'shared'])

			log.length = 0
			const reply = wsMessage(ws)
			ws.send('hi')
			await reply
			expect(log).toEqual(['shared'])
			await wsClosed(ws)
		} finally {
			app.stop(true)
		}
	})

	it('runs upgrade hooks once, in order', async () => {
		const app = diamond(new Elysia().use(websocket())).listen(0)

		try {
			for (const path of ['/plain', '/g/x']) {
				log.length = 0
				const ws = newWebsocket(app.server!, path)
				await wsOpen(ws)
				await wsClosed(ws)
				expect(log).toEqual(['A', 'audit', 'B', 'F', 'G'])
			}
		} finally {
			app.stop(true)
		}
	})
})

describe('compact beforeHandle prefix', () => {
	// a route whose own chain holds a named plugin's registration composes
	// in full, so a duplicate can drop
	const prefixOf = (plugin: AnyElysia) => {
		const app = new Elysia()
			.use(named('audit').onBeforeHandle('global', mark('audit')))
			.onBeforeHandle(mark('B'))
			.use(plugin) as any
		const route = app['~routes'].find((r: any) => r[1] === '/r')
		const hook = composeRouteHook(
			route[3],
			route[4],
			route[5],
			route[6],
			app,
			route[7],
			true
		)

		return hook?.['~beforeHandlePrefix']?.length
	}

	it('stays on for an unnamed plugin', () => {
		expect(
			prefixOf(new Elysia().onBeforeHandle(mark('F')).get('/r', ok))
		).toBe(2)
	})

	it('stays on for a named plugin without registrations', () => {
		expect(prefixOf(named('feature').get('/r', ok))).toBe(2)
	})

	// a `local` registration has no key: nothing in the route's chain can
	// drop, so the compact lane stays on
	it('stays on for a named plugin local registration', () => {
		expect(
			prefixOf(named('feature').onBeforeHandle(mark('F')).get('/r', ok))
		).toBe(2)
	})

	it('drops a memoized prefix when a late .as() repeats a twin key', () => {
		// `.as()` names the local hook with the key the same-name twin put on
		// the chain: one registration (D1), and the memoized prefix of the
		// two must not survive
		const twin = named('cm', 1).onBeforeHandle('global', mark('twin'))
		const x = named('cm', 1)
			.use(twin)
			.onBeforeHandle(mark('own'))
			.use(new Elysia().get('/c', ok)) as any
		const route = x['~routes'].find((r: any) => r[1] === '/c')
		const compose = () =>
			composeRouteHook(
				route[3],
				route[4],
				route[5],
				route[6],
				x,
				route[7],
				true
			) as any
		const run = (hook: any) => {
			log.length = 0
			const fns: Function[] = []
			for (let c = hook?.['~beforeHandlePrefix']?.tail; c; c = c.parent)
				fns.unshift(...c.values)
			for (const fn of [].concat(hook?.beforeHandle ?? [])) fns.push(fn)
			for (const fn of fns) fn({})
			return log.slice()
		}

		const before = compose()
		expect(before['~beforeHandlePrefix'].length).toBe(2)
		expect(run(before)).toEqual(['twin', 'own'])

		x.as('global')
		const after = compose()
		expect(after?.['~beforeHandlePrefix']).toBeUndefined()
		expect(run(after)).toEqual(['own'])
	})

	it('stays off for a named plugin the route chain installs', () => {
		const audit = named('audit').onBeforeHandle('global', mark('audit'))
		expect(prefixOf(new Elysia().use(audit).get('/r', ok))).toBeUndefined()
	})
})
