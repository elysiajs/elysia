import { describe, expect, it } from 'bun:test'
import { Cookie, createCookieJar } from '../../src/cookies'
import type { Context } from '../../src'

const create = () => {
	const set: Context['set'] = {
		cookie: {},
		headers: {}
	}

	const cookie = createCookieJar(set, {})

	return {
		cookie,
		set
	}
}

describe('Explicit Cookie', () => {
	it('create cookie', () => {
		const { cookie, set } = create()
		cookie.name.value = 'himari'

		expect(set.cookie?.name).toEqual({
			value: 'himari'
		})
	})

	it('add cookie attribute', () => {
		const { cookie, set } = create()
		cookie.name.value = 'himari'

		cookie.name.update({
			domain: 'millennium.sh'
		})

		expect(set.cookie?.name).toEqual({
			value: 'himari',
			domain: 'millennium.sh'
		})
	})

	it('add cookie attribute without overwrite entire property', () => {
		const { cookie, set } = create()
		cookie.name.value = 'himari'
		cookie.name.domain = 'millennium.sh'

		cookie.name.update({
			httpOnly: true,
			path: '/'
		})

		expect(set.cookie?.name).toEqual({
			value: 'himari',
			domain: 'millennium.sh',
			httpOnly: true,
			path: '/'
		})
	})

	it('set cookie attribute', () => {
		const { cookie, set } = create()
		cookie.name.value = 'himari'
		cookie.name.domain = 'millennium.sh'

		cookie.name.set({
			httpOnly: true,
			path: '/'
		})

		expect(set.cookie?.name).toEqual({
			httpOnly: true,
			path: '/',
			value: 'himari'
		})
	})

	it('add cookie overwrite attribute if duplicated', () => {
		const { cookie, set } = create()
		cookie.name.set({
			value: 'aru',
			domain: 'millennium.sh',
			httpOnly: true
		})

		cookie.name.update({
			domain: 'gehenna.sh'
		})

		expect(set.cookie?.name).toEqual({
			value: 'aru',
			domain: 'gehenna.sh',
			httpOnly: true
		})
	})

	it('default undefined cookie with undefined', () => {
		const { cookie, set } = create()
		cookie.name

		expect(cookie?.name?.value).toEqual(undefined)
	})

	it('overwrite existing cookie', () => {
		const { cookie, set } = create()
		cookie.name.value = 'aru'
		cookie.name.value = 'himari'

		expect(set.cookie?.name).toEqual({ value: 'himari' })
	})

	it('remove cookie', () => {
		const { cookie, set } = create()
		cookie.name.value = 'himari'
		cookie.name.remove()

		expect(set.cookie?.name.expires?.getTime()).toBeLessThanOrEqual(
			Date.now()
		)
	})
})
