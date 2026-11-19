import { describe, expect, it } from 'bun:test'

import { Elysia } from '../../src'
import { signCookie } from '../../src/utils'

describe('Plugin cookie config', () => {
	for (const aot of [true, false])
		it(`preserves enclosing signing policy through nested imports with aot: ${aot}`, async () => {
			const secret = 'enclosing plugin secret'
			const inner = new Elysia({ cookie: { httpOnly: true } }).get(
				'/nested',
				({ cookie }) => cookie.session.value
			)
			const enclosing = new Elysia({
				cookie: { secrets: secret, sign: ['session'] }
			}).use(inner)
			const app = new Elysia({ aot }).use(enclosing)
			const request = (value: string) =>
				app.handle(
					new Request('http://localhost/nested', {
						headers: { cookie: `session=${value}` }
					})
				)

			expect((await request('forged.signature')).status).toBe(400)
			const valid = await request(await signCookie('plain', secret))
			expect(valid.status).toBe(200)
			expect(await valid.text()).toBe('plain')
		})

	for (const aot of [true, false])
		it(`preserves each plugin's signing policy with aot: ${aot}`, async () => {
			const firstSecret = 'first plugin secret'
			const secondSecret = 'second plugin secret'
			const first = new Elysia({
				cookie: { secrets: firstSecret, sign: ['session'] }
			}).get('/first', ({ cookie }) => cookie.session.value)
			const second = new Elysia({
				cookie: { secrets: secondSecret, sign: ['session'] }
			}).get('/second', ({ cookie }) => cookie.session.value)
			const app = new Elysia({ aot }).use(first).use(second)

			const request = (path: string, value: string) =>
				app.handle(
					new Request(`http://localhost${path}`, {
						headers: { cookie: `session=${value}` }
					})
				)

			const firstSigned = await signCookie('first', firstSecret)
			const secondSigned = await signCookie('second', secondSecret)

			expect((await request('/first', firstSigned)).status).toBe(200)
			expect((await request('/second', secondSigned)).status).toBe(200)
			expect((await request('/first', secondSigned)).status).toBe(400)
			expect((await request('/second', firstSigned)).status).toBe(400)
			expect((await request('/first', 'forged.signature')).status).toBe(400)
		})

	for (const aot of [true, false])
		it(`keeps parent cookie config for unconfigured plugins with aot: ${aot}`, async () => {
			const secret = 'parent secret'
			const plugin = new Elysia().get(
				'/plugin',
				({ cookie }) => cookie.session.value
			)
			const app = new Elysia({
				aot,
				cookie: { secrets: secret, sign: ['session'] }
			}).use(plugin)
			const signed = await signCookie('parent', secret)

			const request = (value: string) =>
				app.handle(
					new Request('http://localhost/plugin', {
						headers: { cookie: `session=${value}` }
					})
				)

			expect((await request(signed)).status).toBe(200)
			expect((await request('forged.signature')).status).toBe(400)
		})

	for (const aot of [true, false])
		it(`merges partial plugin config with parent signing policy with aot: ${aot}`, async () => {
			const secret = 'host secret'
			const plugin = new Elysia({ cookie: { httpOnly: true } }).get(
				'/plugin',
				({ cookie }) => cookie.session.value
			)
			const app = new Elysia({
				aot,
				cookie: { secrets: secret, sign: ['session'] }
			}).use(plugin)
			const signed = await signCookie('plain', secret)

			const request = (value: string) =>
				app.handle(
					new Request('http://localhost/plugin', {
						headers: { cookie: `session=${value}` }
					})
				)

			const valid = await request(signed)
			expect(valid.status).toBe(200)
			expect(await valid.text()).toBe('plain')
			expect((await request('forged.signature')).status).toBe(400)
		})

	for (const aot of [true, false])
		it(`preserves signing policy through async plugin factories with aot: ${aot}`, async () => {
			const secret = 'async plugin secret'
			const inner = new Elysia({ cookie: { httpOnly: true } }).get(
				'/async-cookie',
				({ cookie }) => cookie.session.value
			)
			const plugin = new Elysia({
				cookie: { secrets: secret, sign: ['session'] }
			}).use(inner)
			const app = new Elysia({ aot }).use(async () => plugin)

			await app.modules

			const request = (value: string) =>
				app.handle(
					new Request('http://localhost/async-cookie', {
						headers: { cookie: `session=${value}` }
					})
				)

			expect((await request('forged.signature')).status).toBe(400)
			const valid = await request(await signCookie('plain', secret))
			expect(valid.status).toBe(200)
			expect(await valid.text()).toBe('plain')
		})
})
