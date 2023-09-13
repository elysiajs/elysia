import { describe, expect, it } from 'bun:test'
import { parseCookie, Cookie } from '../../src/cookie'
import { sign } from 'cookie-signature'

describe('Parse Cookie', () => {
	it('handle empty cookie', () => {
		const set = {
			headers: {},
			cookie: {}
		}
		const cookieString = ''
		const result = parseCookie(set, cookieString)

		expect(result).toEqual({})
	})

	it('create cookie jar from cookie string', () => {
		const set = {
			headers: {},
			cookie: {}
		}
		const cookieString = 'fischl=Princess; eula=Noble; amber=Knight'
		const result = parseCookie(set, cookieString)
		expect(result).toEqual({
			fischl: expect.any(Cookie),
			eula: expect.any(Cookie),
			amber: expect.any(Cookie)
		})
	})

	it('unsign cookie signature', () => {
		const set = {
			headers: {},
			cookie: {}
		}

		const secret = 'Fischl von Luftschloss Narfidort'

		const fischl = sign('fischl', secret)
		const cookieString = `fischl=${fischl}`
		const result = parseCookie(set, cookieString, {
			secret,
			sign: ['fischl']
		})

		expect(result.fischl.value).toEqual('fischl')
	})

	it('unsign multiple signature', () => {
		const set = {
			headers: {},
			cookie: {}
		}

		const secret = 'Fischl von Luftschloss Narfidort'

		const fischl = sign('fischl', secret)
		const eula = sign('eula', secret)

		const cookieString = `fischl=${fischl}; eula=${eula}`
		const result = parseCookie(set, cookieString, {
			secret,
			sign: ['fischl', 'eula']
		})

		expect(result.fischl.value).toEqual('fischl')
		expect(result.eula.value).toEqual('eula')
	})

	it('parse JSON value', () => {
		const set = {
			headers: {},
			cookie: {}
		}

		const value = {
			eula: 'Vengeance will be mine'
		}

		const cookieString = `letter=${encodeURIComponent(
			JSON.stringify(value)
		)}`
		const result = parseCookie(set, cookieString)
		expect(result.letter.value).toEqual(value)
	})

	it('parse true', () => {
		const set = {
			headers: {},
			cookie: {}
		}

		const cookieString = `letter=true`
		const result = parseCookie(set, cookieString)
		expect(result.letter.value).toEqual(true)
	})

	it('parse false', () => {
		const set = {
			headers: {},
			cookie: {}
		}

		const cookieString = `letter=false`
		const result = parseCookie(set, cookieString)
		expect(result.letter.value).toEqual(false)
	})

	it('parse number', () => {
		const set = {
			headers: {},
			cookie: {}
		}

		const cookieString = `letter=123`
		const result = parseCookie(set, cookieString)
		expect(result.letter.value).toEqual(123)
	})

	it('Unsign signature via secret rotation', () => {
		const set = {
			headers: {},
			cookie: {}
		}

		const secret = 'Fischl von Luftschloss Narfidort'

		const fischl = sign('fischl', secret)
		const cookieString = `fischl=${fischl}`
		const result = parseCookie(set, cookieString, {
			secret: ['New Secret', secret],
			sign: ['fischl']
		})

		expect(result.fischl.value).toEqual('fischl')
	})
})
