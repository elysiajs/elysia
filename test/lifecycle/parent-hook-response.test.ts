// Runtime twin of test/types/parent-hook-response.ts: every response the
// types give a used route is one the route can actually serve, and every
// case the types leave out is one the runtime leaves out too, except a local
// hook registered after `.use()`, which runs but isn't typed

import { describe, expect, it } from 'bun:test'
import { Elysia, status } from '../../src'
import { websocket } from '../../src/plugin/websocket'
import { newWebsocket } from '../ws/utils'

const deny = ({ request }: { request: Request }) =>
	request.headers.has('x-deny') ? status(401, 'no') : undefined

const midDeny = ({ request }: { request: Request }) =>
	request.headers.has('x-mid') ? status(402, 'mid') : undefined

const forbid = ({ request }: { request: Request }) =>
	request.headers.has('x-sibling') ? status(403, 'sibling') : undefined

const routes = () => new Elysia().get('/', () => 'ok')

class MyError extends Error {
	readonly kind = 'my-error'
}

const serve = async (
	app: Elysia<any, any, any, any, any, any, any, any>,
	path: string,
	headers: Record<string, string> = {}
) => {
	await app.modules

	const response = await app.handle(
		new Request(`http://localhost${path}`, { headers })
	)

	return [response.status, await response.text()] as const
}

type Case = [
	name: string,
	app: () => Elysia<any, any, any, any, any, any, any, any>,
	served: [headers: Record<string, string>, status: number, body: string][],
	path?: string
]

const denied: Case[2] = [
	[{}, 200, 'ok'],
	[{ 'x-deny': '1' }, 401, 'no']
]

const cases: Case[] = [
	[
		'local beforeHandle before .use',
		() => new Elysia().beforeHandle(deny).use(routes()),
		denied
	],
	[
		'plugin-scoped beforeHandle before .use',
		() => new Elysia().beforeHandle('plugin', deny).use(routes()),
		denied
	],
	[
		'global beforeHandle before .use',
		() => new Elysia().beforeHandle('global', deny).use(routes()),
		denied
	],
	[
		'a status both the route and the hook serve',
		() =>
			new Elysia()
				.beforeHandle(deny)
				.use(
					new Elysia().get('/', ({ request }) =>
						request.headers.has('x-own') ? status(401, 'own') : 'ok'
					)
				),
		[
			[{}, 200, 'ok'],
			[{ 'x-own': '1' }, 401, 'own'],
			[{ 'x-deny': '1' }, 401, 'no']
		]
	],
	[
		'derive returning a status before .use',
		() =>
			new Elysia()
				.derive(({ request }) => {
					if (request.headers.has('x-deny'))
						return status(401, 'derive')

					return { user: 'saltyaom' }
				})
				.use(routes()),
		[
			[{}, 200, 'ok'],
			[{ 'x-deny': '1' }, 401, 'derive']
		]
	],
	[
		'afterHandle returning a status before .use',
		() =>
			new Elysia()
				.afterHandle(({ request }) =>
					request.headers.has('x-deny')
						? status(401, 'after')
						: undefined
				)
				.use(routes()),
		[
			[{}, 200, 'ok'],
			[{ 'x-deny': '1' }, 401, 'after']
		]
	],
	[
		'root before .use of a plugin that uses the routes',
		() => new Elysia().beforeHandle(deny).use(new Elysia().use(routes())),
		denied
	],
	[
		'intermediate plugin before its own .use',
		() =>
			new Elysia().use(new Elysia().beforeHandle(midDeny).use(routes())),
		[
			[{}, 200, 'ok'],
			[{ 'x-mid': '1' }, 402, 'mid']
		]
	],
	[
		'root and intermediate plugin before .use',
		() =>
			new Elysia()
				.beforeHandle(deny)
				.use(new Elysia().beforeHandle(midDeny).use(routes())),
		[
			[{}, 200, 'ok'],
			[{ 'x-deny': '1' }, 401, 'no'],
			[{ 'x-mid': '1' }, 402, 'mid']
		]
	],
	[
		'guard with a callback',
		() =>
			new Elysia().guard({ beforeHandle: deny }, (app) =>
				app.use(routes())
			),
		denied
	],
	[
		'standalone guard before .use',
		() => new Elysia().guard({ beforeHandle: deny }).use(routes()),
		denied
	],
	[
		'hook before a guard wrapping .use',
		() =>
			new Elysia()
				.beforeHandle(deny)
				.guard({}, (app) => app.use(routes())),
		denied
	],
	[
		'hook before a group wrapping .use',
		() =>
			new Elysia()
				.beforeHandle(deny)
				.group('/g', (app) => app.use(routes())),
		denied,
		'/g'
	],
	[
		'hook inside a group before .use',
		() =>
			new Elysia().group('/g', (app) =>
				app.beforeHandle(deny).use(routes())
			),
		denied,
		'/g'
	],
	[
		'prefixed parent',
		() => new Elysia({ prefix: '/api' }).beforeHandle(deny).use(routes()),
		denied,
		'/api'
	],
	[
		'array .use',
		() => new Elysia().beforeHandle(deny).use([routes()]),
		denied
	],
	[
		'prefixed parent, array .use',
		() => new Elysia({ prefix: '/api' }).beforeHandle(deny).use([routes()]),
		denied,
		'/api'
	],
	[
		'async plugin instance',
		() => new Elysia().beforeHandle(deny).use(Promise.resolve(routes())),
		denied
	],
	[
		'prefixed parent, async plugin instance',
		() =>
			new Elysia({ prefix: '/api' })
				.beforeHandle(deny)
				.use(Promise.resolve(routes())),
		denied,
		'/api'
	],
	[
		"earlier sibling's plugin-scoped hook",
		() =>
			new Elysia()
				.use(new Elysia().beforeHandle('plugin', forbid))
				.use(routes()),
		[
			[{}, 200, 'ok'],
			[{ 'x-sibling': '1' }, 403, 'sibling']
		]
	],
	[
		"earlier sibling's global hook",
		() =>
			new Elysia()
				.use(new Elysia().beforeHandle('global', forbid))
				.use(routes()),
		[
			[{}, 200, 'ok'],
			[{ 'x-sibling': '1' }, 403, 'sibling']
		]
	],
	[
		"earlier sibling's local hook doesn't reach",
		() => new Elysia().use(new Elysia().beforeHandle(forbid)).use(routes()),
		[[{ 'x-sibling': '1' }, 200, 'ok']]
	],
	[
		"earlier array sibling's plugin-scoped hook",
		() =>
			new Elysia().use([
				new Elysia().beforeHandle('plugin', forbid),
				routes()
			]),
		[
			[{}, 200, 'ok'],
			[{ 'x-sibling': '1' }, 403, 'sibling']
		]
	],
	[
		"parent class handler takes over, parent hook's response stays",
		() =>
			new Elysia()
				.error(MyError, () => status(418, 'parent'))
				.beforeHandle(({ request }) =>
					request.headers.has('x-deny')
						? status(403, 'plugin')
						: undefined
				)
				.use(
					new Elysia()
						.error(MyError, () => status(403, 'plugin'))
						.get('/', () => new MyError('x'))
				),
		[
			[{}, 418, 'parent'],
			[{ 'x-deny': '1' }, 403, 'plugin']
		]
	],
	// test/types/error.ts: a catch-all before `.use` types as a union with
	// the plugin's own handler, since it may fall through
	[
		'catch-all .error(fn) before .use',
		() =>
			new Elysia()
				.error(({ request }) =>
					request.headers.has('x-deny')
						? status(418, 'catch-all')
						: undefined
				)
				.use(
					new Elysia()
						.error(MyError, () => status(403, 'plugin'))
						.get('/', () => new MyError('x'))
				),
		[
			[{}, 403, 'plugin'],
			[{ 'x-deny': '1' }, 418, 'catch-all']
		]
	],
	// Not typed (see test/types/parent-hook-response.ts): a local hook after
	// `.use` runs on the plugin's routes, at any nesting level (the order is
	// pinned by test/lifecycle/after-use-hook-order.test.ts); plugin-scoped
	// and global ones don't
	[
		'local hook after .use (runs, not typed)',
		() => new Elysia().use(routes()).beforeHandle(deny),
		denied
	],
	[
		"intermediate plugin's local hook after its .use (runs, not typed)",
		() => new Elysia().use(new Elysia().use(routes()).beforeHandle(deny)),
		denied
	],
	[
		"plugin-scoped hook after .use doesn't reach",
		() => new Elysia().use(routes()).beforeHandle('plugin', deny),
		[[{ 'x-deny': '1' }, 200, 'ok']]
	],
	[
		"global hook after .use doesn't reach",
		() => new Elysia().use(routes()).beforeHandle('global', deny),
		[[{ 'x-deny': '1' }, 200, 'ok']]
	]
]

describe('parent hook responses on used routes', () => {
	for (const [name, app, served, path = '/'] of cases)
		it(name, async () => {
			const instance = app()

			for (const [headers, code, body] of served)
				expect(await serve(instance, path, headers)).toEqual([
					code,
					body
				])
		})

	// The union reaches a used WebSocket route too: the parent's beforeHandle
	// rejects its upgrade with the typed response, as it does for a WebSocket
	// route the parent declares itself
	it('parent beforeHandle rejects a used WebSocket upgrade', async () => {
		const upgrade = async (
			app: Elysia<any, any, any, any, any, any, any, any>
		) => {
			app.listen(0)

			try {
				const rejected = await fetch(
					`http://${app.server!.hostname}:${app.server!.port}/ws`,
					{
						headers: {
							upgrade: 'websocket',
							connection: 'Upgrade',
							'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
							'sec-websocket-version': '13',
							'x-deny': '1'
						}
					}
				)

				const ws = newWebsocket(app.server!)
				const opens = await new Promise<boolean>((resolve) => {
					ws.onopen = () => {
						ws.close()
						resolve(true)
					}
					ws.onerror = () => resolve(false)
					ws.onclose = () => resolve(false)
				})

				return [rejected.status, await rejected.text(), opens]
			} finally {
				await app.stop(true)
			}
		}

		expect(
			await upgrade(
				new Elysia()
					.use(websocket())
					.beforeHandle(deny)
					.ws('/ws', { message() {} })
			)
		).toEqual([401, 'no', true])

		expect(
			await upgrade(
				new Elysia()
					.use(websocket())
					.beforeHandle(deny)
					.use(new Elysia().ws('/ws', { message() {} }))
			)
		).toEqual([401, 'no', true])
	})
})
