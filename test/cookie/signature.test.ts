import { describe, expect, it } from 'bun:test'
import { parseCookie, Cookie } from '../../src/cookies'
import { signCookie } from '../../src/utils'

describe('Parse Cookie', () => {
	it('handle empty cookie', async () => {
		const set = {
			headers: {},
			cookie: {}
		}
		const cookieString = ''
		const result = await parseCookie(set, cookieString)

		expect(result).toEqual({})
	})

	it('create cookie jar from cookie string', async () => {
		const set = {
			headers: {},
			cookie: {}
		}
		const cookieString = 'fischl=Princess; eula=Noble; amber=Knight'
		const result = await parseCookie(set, cookieString)
		expect(result).toEqual({
			fischl: expect.any(Cookie),
			eula: expect.any(Cookie),
			amber: expect.any(Cookie)
		})
	})

	it('unsign cookie signature', async () => {
		const set = {
			headers: {},
			cookie: {}
		}

		const secrets = 'Fischl von Luftschloss Narfidort'

		const fischl = await signCookie('fischl', secrets)
		const cookieString = `fischl=${fischl}`
		const result = await parseCookie(set, cookieString, {
			secrets,
			sign: ['fischl']
		})

		expect(result.fischl.value).toEqual('fischl')
	})

	it('unsign multiple signature', async () => {
		const set = {
			headers: {},
			cookie: {}
		}

		const secrets = 'Fischl von Luftschloss Narfidort'

		const fischl = await signCookie('fischl', secrets)
		const eula = await signCookie('eula', secrets)

		const cookieString = `fischl=${fischl}; eula=${eula}`
		const result = await parseCookie(set, cookieString, {
			secrets,
			sign: ['fischl', 'eula']
		})

		expect(result.fischl.value).toEqual('fischl')
		expect(result.eula.value).toEqual('eula')
	})

	// it('parse JSON value', async () => {
	// 	const set = {
	// 		headers: {},
	// 		cookie: {}
	// 	}

	// 	const value = {
	// 		eula: 'Vengeance will be mine'
	// 	}

	// 	const cookieString = `letter=${encodeURIComponent(
	// 		JSON.stringify(value)
	// 	)}`
	// 	const result = await parseCookie(set, cookieString)
	// 	expect(result.letter.value).toEqual(value)
	// })

	// it('parse true', async () => {
	// 	const set = {
	// 		headers: {},
	// 		cookie: {}
	// 	}

	// 	const cookieString = `letter=true`
	// 	const result = await parseCookie(set, cookieString)
	// 	expect(result.letter.value).toEqual(true)
	// })

	// it('parse false', async () => {
	// 	const set = {
	// 		headers: {},
	// 		cookie: {}
	// 	}

	// 	const cookieString = `letter=false`
	// 	const result = await parseCookie(set, cookieString)
	// 	expect(result.letter.value).toEqual(false)
	// })

	// it('parse number', async () => {
	// 	const set = {
	// 		headers: {},
	// 		cookie: {}
	// 	}

	// 	const cookieString = `letter=123`
	// 	const result = await parseCookie(set, cookieString)
	// 	expect(result.letter.value).toEqual(123)
	// })

	it('Unsign signature via secret rotation', async () => {
		const set = {
			headers: {},
			cookie: {}
		}

		const secret = 'Fischl von Luftschloss Narfidort'

		const fischl = await signCookie('fischl', secret)
		const cookieString = `fischl=${fischl}`
		const result = await parseCookie(set, cookieString, {
			secrets: ['New Secret', secret],
			sign: ['fischl']
		})

		expect(result.fischl.value).toEqual('fischl')
	})
})
