import { describe, expect, it } from 'bun:test'
import { Cookie, createCookieJar } from '../../src/cookie'
import type { Context } from '../../src'

const create = () => {
	const set: Context['set'] = {
		cookie: {},
		headers: {}
	}

	const cookie = createCookieJar(set)

	return {
		cookie,
		set
	}
}

describe('Create Cookie Jar', () => {
	it('create cookie', () => {
		const { cookie, set } = create()
		cookie.name = new Cookie('himari')

		expect(set.cookie.name).toEqual({
			value: 'himari'
		})
	})

	it('add cookie attribute', () => {
		const { cookie, set } = create()
		cookie.name = new Cookie('himari')

		cookie.name.add({
			domain: 'millennium.sh'
		})

		expect(set.cookie.name).toEqual({
			value: 'himari',
			domain: 'millennium.sh'
		})
	})

	it('add cookie attribute without overwrite entire property', () => {
		const { cookie, set } = create()
		cookie.name = new Cookie('himari', {
			domain: 'millennium.sh'
		}).add({
			httpOnly: true,
			path: '/'
		})

		expect(set.cookie.name).toEqual({
			value: 'himari',
			domain: 'millennium.sh',
			httpOnly: true,
			path: '/'
		})
	})

	it('set cookie attribute', () => {
		const { cookie, set } = create()
		cookie.name = new Cookie('himari', {
			domain: 'millennium.sh'
		})

		cookie.name.set({
			httpOnly: true,
			path: '/'
		})

		expect(set.cookie.name).toEqual({
			value: 'himari',
			httpOnly: true,
			path: '/'
		})
	})

	it('add cookie overwrite attribute if duplicated', () => {
		const { cookie, set } = create()
		cookie.name = new Cookie('aru', {
			domain: 'millennium.sh',
			httpOnly: true
		}).add({
			domain: 'gehenna.sh'
		})

		expect(set.cookie.name).toEqual({
			value: 'aru',
			domain: 'gehenna.sh',
			httpOnly: true
		})
	})

	it('create cookie with empty string', () => {
		const { cookie, set } = create()
		cookie.name = new Cookie('')

		expect(set.cookie.name).toEqual({ value: '' })
	})

	it('Overwrite existing cookie', () => {
		const { cookie, set } = create()
		cookie.name = new Cookie('aru')
		cookie.name = new Cookie('himari')

		expect(set.cookie.name).toEqual({ value: 'himari' })
	})

	it('Overwrite existing cookie', () => {
		const { cookie, set } = create()
		cookie.name = new Cookie('himari')

		delete cookie.name

		expect(set.cookie.name.expires?.getTime()).toBeLessThanOrEqual(
			Date.now()
		)
	})
})
