import { describe, it, expect } from 'bun:test'
import type { Server } from 'bun'
import { Elysia, status, type AnyElysia } from '../../src'
import { websocket } from '../../src/plugin/websocket'
import { wsOpen, wsMessage, wsClosed } from './utils'

/**
 * An inherited `beforeHandle` is where an app puts authentication: declared
 * once on the root, a guard or a global auth plugin, so every route mounted
 * below it is protected. The HTTP JIT runs an inherited chain made only of
 * `beforeHandle`s from a compact `~beforeHandlePrefix`. The WS lane never
 * read that field, so a WS route living in a plugin upgraded a peer with no
 * credentials while the HTTP route beside it answered 401. Elysia 1.4
 * rejected both.
 *
 * Each case asserts parity with an HTTP route in the same plugin, then that
 * a credentialed peer still opens and round-trips a frame, so a "fix" that
 * refuses every upgrade fails too.
 */

const credential = 'session=ok'

const deny = ({ request }: { request: Request }) =>
	request.headers.get('cookie') === credential
		? undefined
		: status(401, 'Unauthorized')

/** Status of a real (non-simulated) upgrade attempt against a live server. */
const upgradeStatus = async (
	server: Server<any>,
	path: string,
	cookie?: string
) =>
	(
		await fetch(`http://${server.hostname}:${server.port}${path}`, {
			headers: {
				upgrade: 'websocket',
				connection: 'Upgrade',
				'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
				'sec-websocket-version': '13',
				...(cookie ? { cookie } : {})
			}
		})
	).status

const connect = (server: Server<any>, path: string) =>
	new WebSocket(`ws://${server.hostname}:${server.port}${path}`, {
		headers: { cookie: credential }
	} as any)

// The routes being protected, mounted from a plugin like a controller would be
const routes = (plugin = new Elysia()) =>
	plugin
		.get('/http', () => 'ok')
		.ws('/ws', {
			message(ws, message) {
				ws.send(message)
			}
		})

const shapes: Array<[name: string, build: () => AnyElysia, prefix?: string]> = [
	[
		'a root hook registered before .use()',
		() => new Elysia().use(websocket()).beforeHandle(deny).use(routes())
	],
	[
		'a global hook from an anonymous plugin',
		() =>
			new Elysia()
				.use(websocket())
				.use(new Elysia().beforeHandle('global', deny))
				.use(routes())
	],
	[
		'a global hook from a named auth plugin',
		() =>
			new Elysia()
				.use(websocket())
				.use(new Elysia({ name: 'auth' }).beforeHandle('global', deny))
				.use(routes())
	],
	[
		"a 'plugin' scoped hook from a sibling plugin",
		() =>
			new Elysia()
				.use(websocket())
				.use(new Elysia().beforeHandle('plugin', deny))
				.use(routes())
	],
	[
		'a root hook, routes nested two plugins deep',
		() =>
			new Elysia()
				.use(websocket())
				.beforeHandle(deny)
				.use(new Elysia().use(routes()))
	],
	[
		'a hook on an intermediate plugin',
		() =>
			new Elysia()
				.use(websocket())
				.use(new Elysia().beforeHandle(deny).use(routes()))
	],
	[
		'a global hook on an intermediate plugin',
		() =>
			new Elysia()
				.use(websocket())
				.use(new Elysia().beforeHandle('global', deny).use(routes()))
	],
	[
		'a guard without a callback',
		() =>
			new Elysia()
				.use(websocket())
				.guard({ beforeHandle: deny })
				.use(routes())
	],
	[
		'a route plugin that has a beforeHandle of its own',
		() =>
			new Elysia()
				.use(websocket())
				.beforeHandle(deny)
				.use(routes(new Elysia().beforeHandle(() => {})))
	],
	[
		'a root hook under precompile',
		() =>
			new Elysia({ precompile: true })
				.use(websocket())
				.beforeHandle(deny)
				.use(routes())
	],
	[
		'a global hook under precompile',
		() =>
			new Elysia({ precompile: true })
				.use(websocket())
				.use(new Elysia().beforeHandle('global', deny))
				.use(routes())
	],
	// Never compacted (a macro or scoped child anywhere in the app, a derive
	// in the chain, or a hook added after `.use()`), so these held already.
	// They pin that WS parity does not depend on those unrelated gates
	[
		'a guard with a callback',
		() =>
			new Elysia()
				.use(websocket())
				.guard({ beforeHandle: deny }, (app) => app.use(routes()))
	],
	[
		'a group',
		() =>
			new Elysia()
				.use(websocket())
				.group('/g', { beforeHandle: deny }, (app) =>
					app.use(routes())
				),
		'/g'
	],
	[
		'a macro applied through a guard',
		() =>
			new Elysia()
				.use(websocket())
				.macro({ auth: { beforeHandle: deny } })
				.guard({ auth: true })
				.use(routes())
	],
	[
		'a derive registered before the hook',
		() =>
			new Elysia()
				.use(websocket())
				.derive(() => ({ user: 'alice' }))
				.beforeHandle(deny)
				.use(routes())
	],
	[
		'a root hook registered after .use()',
		() => new Elysia().use(websocket()).use(routes()).beforeHandle(deny)
	]
]

describe('WebSocket inherited beforeHandle enforcement', () => {
	for (const [name, build, prefix = ''] of shapes)
		it(`rejects an unauthenticated upgrade guarded by ${name}`, async () => {
			const app = build().listen(0)

			try {
				const http = (await app.handle(`${prefix}/http`)).status
				const denied = await upgradeStatus(app.server!, `${prefix}/ws`)
				const allowed = await upgradeStatus(
					app.server!,
					`${prefix}/ws`,
					credential
				)

				// negative control: the hook must admit a credentialed peer
				const ws = connect(app.server!, `${prefix}/ws`)
				await wsOpen(ws)
				const echo = wsMessage(ws)
				ws.send('hello')
				const frame = String((await echo).data)
				await wsClosed(ws)

				expect(http).toBe(401)
				expect(denied).toBe(http)
				expect(allowed).toBe(101)
				expect(frame).toBe('hello')
			} finally {
				app.stop(true)
			}
		})

	// `beforeHandle` also runs per frame on WS: inherited ones must too, or a
	// hook that vets message content protects only root-mounted routes
	it('runs an inherited beforeHandle on every message frame', async () => {
		const app = new Elysia()
			.use(websocket())
			.beforeHandle(({ body }: { body?: unknown }) =>
				body === 'forbidden' ? 'refused' : undefined
			)
			.use(routes())
			.listen(0)

		try {
			const ws = connect(app.server!, '/ws')
			await wsOpen(ws)

			const refused = wsMessage(ws)
			ws.send('forbidden')
			const first = String((await refused).data)

			const echoed = wsMessage(ws)
			ws.send('hello')
			const second = String((await echoed).data)

			await wsClosed(ws)

			expect(first).toBe('refused')
			expect(second).toBe('hello')
		} finally {
			app.stop(true)
		}
	})

	// The upgrade is the only gate: an unauthenticated peer that got through
	// reached `open` and `message` with nothing to stop it
	it('never runs open or message for a peer the inherited hook refused', async () => {
		const reached: string[] = []

		const app = new Elysia()
			.use(websocket())
			.beforeHandle(deny)
			.use(
				new Elysia().ws('/ws', {
					open() {
						reached.push('open')
					},
					message(ws) {
						reached.push('message')
						ws.send('ack')
					}
				})
			)
			.listen(0)

		try {
			const anonymous = new WebSocket(
				`ws://${app.server!.hostname}:${app.server!.port}/ws`
			)
			const opened = await new Promise<boolean>((resolve) => {
				anonymous.onopen = () => {
					anonymous.send('hello')
					resolve(true)
				}
				anonymous.onclose = () => resolve(false)
			})
			anonymous.close()

			// a credentialed session proves the recorder sees a real peer
			const ws = connect(app.server!, '/ws')
			await wsOpen(ws)
			const ack = wsMessage(ws)
			ws.send('hello')
			await ack
			await wsClosed(ws)

			expect(opened).toBe(false)
			expect(reached).toEqual(['open', 'message'])
		} finally {
			app.stop(true)
		}
	})
})

describe('route introspection of an inherited beforeHandle', () => {
	// The compact inherited-`beforeHandle` prefix is an HTTP JIT detail. Every
	// other consumer composes the flat hook, or a tool auditing or running
	// hooks from `app.routes` sees a plugin route with no auth hook at all
	it('lists the inherited hook on a plugin route', () => {
		const app = new Elysia().beforeHandle(deny).use(routes())

		const http = app.routes.find((route) => route.path === '/http')!
		const beforeHandle = [http.hooks.beforeHandle ?? []].flat()

		expect(beforeHandle).toContain(deny)
		expect(http.hooks).not.toHaveProperty('~beforeHandlePrefix')
	})
})
