import { describe, expect, it } from 'bun:test'
import { parseCookie, Cookie } from '../../src/cookies'
import { signCookie, unsignCookie } from '../../src/utils'

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

	it('rejects malformed and modified signatures', async () => {
		const secret = 'Fischl von Luftschloss Narfidort'
		const signed = await signCookie('fischl', secret)
		const dot = signed.lastIndexOf('.')
		const value = signed.slice(0, dot)
		const signature = signed.slice(dot + 1)
		const modified =
			signature.slice(0, -1) +
			(signature.charCodeAt(signature.length - 1) === 65 ? 'B' : 'A')

		expect(await unsignCookie(signed, secret)).toBe('fischl')
		expect(await unsignCookie(`${value}.${modified}`, secret)).toBe(false)
		expect(await unsignCookie(`${value}.not-base64!`, secret)).toBe(false)
		expect(
			await unsignCookie(`${value}.${signature.slice(0, -1)}`, secret)
		).toBe(false)
		expect(await unsignCookie(`${value}.${signature}A`, secret)).toBe(false)
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
