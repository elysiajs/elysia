import { describe, expect, it } from 'bun:test'

import { Elysia, t } from '../../src'
import { signCookie, unsignCookie } from '../../src/cookie/crypto'
import { autoHead } from '../../src/plugin/auto-head'
import { websocket } from '../../src/plugin/websocket'

const withCookie = (value: string) => ({
	headers: { cookie: `session=${value}` }
})

for (const precompile of [false, true])
	describe(`plugin cookie config with precompile: ${precompile}`, () => {
		it('preserves signing and response attributes', async () => {
			const secret = 'plugin secret'
			const plugin = new Elysia({
				cookie: {
					secrets: secret,
					sign: ['session'],
					httpOnly: true,
					secure: true,
					sameSite: 'lax'
				}
			}).get('/plugin', ({ cookie: { session } }) => {
				session.value = 'value'
				return 'ok'
			})
			const app = new Elysia({ precompile }).use(plugin)

			expect(
				(await app.handle('/plugin', withCookie('forged.signature')))
					.status
			).toBe(400)

			const response = await app.handle('/plugin')
			const setCookie = response.headers.get('set-cookie')
			expect(setCookie).toInclude('session=value.')
			expect(setCookie).toInclude('HttpOnly')
			expect(setCookie).toInclude('Secure')
			expect(setCookie).toInclude('SameSite=Lax')
		})

		it('preserves enclosing policy through nested plugins', async () => {
			const secret = 'enclosing plugin secret'
			const inner = new Elysia({ cookie: { httpOnly: true } }).get(
				'/nested',
				({ cookie: { session } }) => session.value
			)
			const enclosing = new Elysia({
				cookie: { secrets: secret, sign: ['session'] }
			}).use(inner)
			const app = new Elysia({ precompile }).use(enclosing)

			expect(
				(await app.handle('/nested', withCookie('forged.signature')))
					.status
			).toBe(400)

			const valid = await app.handle(
				'/nested',
				withCookie(await signCookie('plain', secret))
			)
			expect(valid.status).toBe(200)
			expect(await valid.text()).toBe('plain')
		})

		it('isolates sibling plugin secrets', async () => {
			const firstSecret = 'first plugin secret'
			const secondSecret = 'second plugin secret'
			const first = new Elysia({
				cookie: { secrets: firstSecret, sign: ['session'] }
			}).get('/first', ({ cookie: { session } }) => session.value)
			const second = new Elysia({
				cookie: { secrets: secondSecret, sign: ['session'] }
			}).get('/second', ({ cookie: { session } }) => session.value)
			const app = new Elysia({ precompile }).use(first).use(second)
			const firstSigned = await signCookie('first', firstSecret)
			const secondSigned = await signCookie('second', secondSecret)

			expect(
				(await app.handle('/first', withCookie(firstSigned))).status
			).toBe(200)
			expect(
				(await app.handle('/second', withCookie(secondSigned))).status
			).toBe(200)
			expect(
				(await app.handle('/first', withCookie(secondSigned))).status
			).toBe(400)
			expect(
				(await app.handle('/second', withCookie(firstSigned))).status
			).toBe(400)
		})

		it('keeps parent policy for an unconfigured plugin', async () => {
			const secret = 'parent secret'
			const plugin = new Elysia().get(
				'/parent',
				({ cookie: { session } }) => session.value
			)
			const app = new Elysia({
				precompile,
				cookie: { secrets: secret, sign: ['session'] }
			}).use(plugin)

			expect(
				(
					await app.handle(
						'/parent',
						withCookie(await signCookie('parent', secret))
					)
				).status
			).toBe(200)
			expect(
				(await app.handle('/parent', withCookie('forged.signature')))
					.status
			).toBe(400)
		})

		it('merges partial plugin config with parent signing', async () => {
			const secret = 'parent secret'
			const plugin = new Elysia({ cookie: { httpOnly: true } }).get(
				'/partial',
				({ cookie: { session } }) => {
					session.value = session.value ?? 'set'
					return session.value
				}
			)
			const app = new Elysia({
				precompile,
				cookie: { secrets: secret, sign: ['session'] }
			}).use(plugin)

			const valid = await app.handle(
				'/partial',
				withCookie(await signCookie('plain', secret))
			)
			expect(valid.status).toBe(200)
			expect(await valid.text()).toBe('plain')
			expect(
				(await app.handle('/partial', withCookie('forged.signature')))
					.status
			).toBe(400)
			expect(
				(await app.handle('/partial')).headers.get('set-cookie')
			).toInclude('HttpOnly')
		})

		it('lets child config override parent config', async () => {
			const parentSecret = 'parent secret'
			const childSecret = 'child secret'
			const plugin = new Elysia({
				cookie: {
					secrets: childSecret,
					sign: ['session'],
					httpOnly: true,
					maxAge: 2
				}
			}).get('/child', ({ cookie: { session } }) => {
				session.value = session.value ?? 'set'
				return session.value
			})
			const app = new Elysia({
				precompile,
				cookie: {
					secrets: parentSecret,
					sign: ['session'],
					httpOnly: false,
					maxAge: 1
				}
			}).use(plugin)

			expect(
				(
					await app.handle(
						'/child',
						withCookie(await signCookie('child', childSecret))
					)
				).status
			).toBe(200)
			expect(
				(
					await app.handle(
						'/child',
						withCookie(await signCookie('parent', parentSecret))
					)
				).status
			).toBe(400)

			const setCookie = (await app.handle('/child')).headers.get(
				'set-cookie'
			)
			expect(setCookie).toInclude('HttpOnly')
			expect(setCookie).toInclude('Max-Age=2')
		})

		it('keeps route-local policy nearest to the route', async () => {
			const pluginSecret = 'plugin secret'
			const routeSecret = 'route secret'
			const plugin = new Elysia({
				cookie: {
					secrets: pluginSecret,
					sign: ['session'],
					httpOnly: true,
					maxAge: 1
				}
			}).get(
				'/route-local',
				{
					cookie: t.Cookie(
						{ session: t.Optional(t.String()) },
						{
							secrets: routeSecret,
							sign: ['session'],
							httpOnly: false,
							secure: true,
							maxAge: 2
						}
					)
				},
				({ cookie: { session } }) => {
					session.value = session.value ?? 'set'
					return session.value
				}
			)
			const app = new Elysia({ precompile }).use(plugin)

			expect(
				(
					await app.handle(
						'/route-local',
						withCookie(await signCookie('route', routeSecret))
					)
				).status
			).toBe(200)
			expect(
				(
					await app.handle(
						'/route-local',
						withCookie(await signCookie('plugin', pluginSecret))
					)
				).status
			).toBe(400)

			const setCookie = (await app.handle('/route-local')).headers.get(
				'set-cookie'
			)
			expect(setCookie).toInclude('Max-Age=2')
			expect(setCookie).toInclude('Secure')
			expect(setCookie).not.toInclude('HttpOnly')
		})

		it('preserves policy through an async plugin factory', async () => {
			const secret = 'async plugin secret'
			const plugin = new Elysia({
				cookie: { secrets: secret, sign: ['session'] }
			}).get('/async', ({ cookie: { session } }) => session.value)
			const app = new Elysia({ precompile }).use(async () => plugin)

			await app.modules

			expect(
				(await app.handle('/async', withCookie('forged.signature')))
					.status
			).toBe(400)
			expect(
				(
					await app.handle(
						'/async',
						withCookie(await signCookie('plain', secret))
					)
				).status
			).toBe(200)
		})

		it('copies policy to generated HEAD routes', async () => {
			const secret = 'head plugin secret'
			const plugin = new Elysia({
				cookie: { secrets: secret, sign: ['session'] }
			}).get('/head', ({ cookie: { session } }) => session.value)
			const app = new Elysia({ precompile }).use(plugin).use(autoHead())

			await app.modules

			expect(
				(
					await app.handle('/head', {
						method: 'HEAD',
						...withCookie('forged.signature')
					})
				).status
			).toBe(400)
			expect(
				(
					await app.handle('/head', {
						method: 'HEAD',
						...withCookie(await signCookie('plain', secret))
					})
				).status
			).toBe(200)
		})
	})

describe('plugin cookie config on WebSocket routes', () => {
	const secret = 'ws plugin secret'
	const signing = { cookie: { secrets: secret, sign: ['session'] } }

	const wsApp = (config: object, plugin: object) => {
		const seen: unknown[] = []
		const app = new Elysia(config)
			.use(websocket())
			.use(
				new Elysia(plugin).ws('/ws', {
					beforeHandle({ cookie: { session } }) {
						seen.push(session.value)

						if (session.value === undefined) {
							session.value = 'minted'
							return 'sign in first'
						}
					},
					open(ws) {
						ws.close()
					}
				})
			)
			.listen(0)

		return { app, seen }
	}

	const upgrade = (app: any, cookie: string) =>
		fetch(`http://${app.server.hostname}:${app.server.port}/ws`, {
			headers: {
				upgrade: 'websocket',
				connection: 'Upgrade',
				'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
				'sec-websocket-version': '13',
				cookie
			},
			keepalive: false
		})

	// the plugin's policy must be as strict as the same policy on the root:
	// a socket opened on a forged cookie is an authentication bypass
	for (const [where, root, plugin] of [
		['root', signing, {}],
		['plugin', {}, signing]
	] as const)
		it(`verifies and signs the session from ${where} config`, async () => {
			const { app, seen } = wsApp(root, plugin)

			try {
				const forged = await upgrade(app, 'session=forged.sig')
				expect(forged.status).toBe(400)
				expect(seen).toEqual([])
				await forged.body?.cancel()

				const signed = await upgrade(
					app,
					`session=${encodeURIComponent(await signCookie('user', secret))}`
				)
				expect(signed.status).toBe(101)
				expect(seen).toEqual(['user'])

				const anonymous = await upgrade(app, '')
				const pair = anonymous.headers
					.getSetCookie()[0]!
					.split(';')[0]!
					.slice('session='.length)
				await anonymous.body?.cancel()

				expect(
					await unsignCookie(
						decodeURIComponent(pair),
						secret,
						'session'
					)
				).toBe('minted')
			} finally {
				app.stop(true)
			}
		})
})
