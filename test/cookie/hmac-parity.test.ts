import '../../src/compile/aot-capture'
import { describe, expect, it, afterEach } from 'bun:test'

import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled, Capture } from '../../src/compile/aot'
import {
	endValidatorCapture,
	endHandlerCapture
} from '../../src/compile/aot-capture'
import { compileHandler } from '../../src/compile/handler'
import { req } from '../utils'

import {
	hasSyncHmac,
	signCookie,
	signCookieSync,
	signCookieSubtle,
	unsignCookie,
	unsignCookieSync
} from '../../src/cookie/crypto'

const secret = 'the-seven-wailings-koan-of-jericho'
const cases = [
	'',
	'hello',
	'hello world',
	'a value with = padding trigger',
	'unicode: 日本語 🍣 café',
	JSON.stringify([{ name: 'Rin', role: 'Administration' }]),
	'x'.repeat(1024)
]

describe('cookie HMAC sync and WebCrypto parity', () => {
	it('sync node:crypto HMAC is available in this runtime', () => {
		expect(hasSyncHmac).toBe(true)
	})

	it('sync and WebCrypto signatures are byte-identical', async () => {
		for (const value of cases) {
			const sync = signCookieSync(value, secret)
			const subtle = await signCookieSubtle(value, secret)

			expect(sync).toBe(subtle)
			expect(sync.startsWith(value + '.')).toBe(true)
			expect(sync.endsWith('=')).toBe(false)
		}
	})

	it('public signCookie matches the WebCrypto reference byte-for-byte', async () => {
		for (const value of cases) {
			const viaPublic = await signCookie(value, secret)
			const viaSubtle = await signCookieSubtle(value, secret)

			expect(viaPublic).toBe(viaSubtle)
		}
	})

	it('a WebCrypto-signed cookie verifies via the sync unsign path', async () => {
		for (const value of cases) {
			const signed = await signCookieSubtle(value, secret)

			expect(unsignCookieSync(signed, secret)).toBe(value)
			await expect(unsignCookie(signed, secret)).resolves.toBe(value)
		}
	})

	it('a sync-signed cookie verifies via the WebCrypto unsign path', async () => {
		for (const value of cases) {
			const signed = signCookieSync(value, secret)

			const subtleSigned = await signCookieSubtle(value, secret)
			expect(signed).toBe(subtleSigned)
			await expect(unsignCookie(signed, secret)).resolves.toBe(value)
		}
	})

	it('sync unsign rejects a tampered signature (timing-safe compare preserved)', () => {
		const signed = signCookieSync('session', secret)
		const [payload] = signed.split('.')

		expect(unsignCookieSync(payload + '.deadbeef', secret)).toBe(false)
		expect(unsignCookieSync(signed, 'wrong-secret')).toBe(false)
		expect(unsignCookieSync('plain', secret)).toBe(false)
	})
})

describe('compiled signed-cookie handlers', () => {
	afterEach(() => {
		Compiled.clear()
		Validator.clear()
	})

	const compileRoute = (app: any, index = 0) => {
		const route = (app as Elysia)['~routes']![index]
		const fn = compileHandler(route as any, app)
		return { fn, name: fn.constructor.name, source: fn.toString() }
	}

	const signedApp = () =>
		new Elysia().get(
			'/',
			{
				cookie: t.Cookie(
					{ name: t.Optional(t.String()) },
					{ secrets: secret, sign: ['name'] }
				)
			},
			({ cookie: { name } }) => {
				name.value = 'himari'
				return 'ok'
			}
		)

	it('uses a synchronous Function when sync HMAC is available', () => {
		expect(hasSyncHmac).toBe(true)

		const { name, source } = compileRoute(signedApp())

		expect(name).toBe('Function')
		expect(source.includes('pcrsg(')).toBe(true)
		expect(source.includes('scvs(')).toBe(true)
		expect(source.includes('await pcr(')).toBe(false)
	})

	it('signed-cookie route round-trips correctly through app.handle', async () => {
		const app = signedApp()

		const res = await app.handle(req('/'))
		const setCookie = res.headers.get('set-cookie') ?? ''

		expect(setCookie.startsWith('name=himari.')).toBe(true)

		const value = setCookie.split(';')[0].slice('name='.length)
		const echo = await app.handle(
			req('/', { headers: { cookie: `name=${value}` } })
		)
		expect(echo.status).toBe(200)
	})

	it('stays async for WebCrypto portability under AOT capture', () => {
		expect(Capture.isCapturing()).toBe(false)

		const prev = process.env.ELYSIA_AOT_BUILD
		process.env.ELYSIA_AOT_BUILD = '1'
		try {
			expect(Capture.isCapturing()).toBe(true)

			const { name, source } = compileRoute(signedApp())

			expect(name).toBe('AsyncFunction')
			expect(source.includes('await pcr(')).toBe(true)
			expect(source.includes('_sg=scv(')).toBe(true)
			expect(source.includes('pcrsg(')).toBe(false)
			expect(source.includes('scvs(')).toBe(false)
		} finally {
			if (prev === undefined) delete process.env.ELYSIA_AOT_BUILD
			else process.env.ELYSIA_AOT_BUILD = prev
			endValidatorCapture()
			endHandlerCapture()
		}
	})
})
