import { describe, expect, it } from 'bun:test'
import { createCookieJar } from '../../src/cookie'

describe('Create Cookie Jar', () => {
	it('create cookie', () => {
		const cookie = createCookieJar()
		cookie.name = 'himari'

		expect(cookie.name.toString()).toBe('himari')
		expect(cookie.name.property).toEqual({})
	})

	it('add cookie attribute without overwrite entire property', () => {
		const cookie = createCookieJar()
		cookie.name = 'himari'
		cookie.name.add!({
			domain: 'millennium.sh'
		})
		cookie.name.add!({
			httpOnly: true,
			path: '/'
		})

		expect(cookie.name.toString()).toBe('himari')
		expect(cookie.name.property).toEqual({
			domain: 'millennium.sh',
			httpOnly: true,
			path: '/'
		})
	})

	it('set cookie attribute', () => {
		const cookie = createCookieJar()
		cookie.name = 'himari'
		cookie.name.set!({
			expires: new Date()
		})
		cookie.name.set!({
			httpOnly: true,
			path: '/'
		})

		expect(cookie.name.toString()).toBe('himari')
		expect(cookie.name.property).toEqual({
			httpOnly: true,
			path: '/'
		})
	})

    it('add cookie overwrite attribute if duplicated', () => {
		const cookie = createCookieJar()
		cookie.name = 'aru'
		cookie.name.add!({
			domain: 'millennium.sh',
            httpOnly: true,
		})
		cookie.name.add!({
			domain: 'gehenna.sh',
		})

		expect(cookie.name.toString()).toBe('aru')
		expect(cookie.name.property).toEqual({
			domain: 'gehenna.sh',
			httpOnly: true,
		})
	})

	it("shouldn't create cookie with undefined", () => {
		const cookie = createCookieJar()
        // @ts-ignore
        cookie.name = undefined

		expect(cookie.name).toBeUndefined()
	})

    it("shouldn't create cookie with null", () => {
		const cookie = createCookieJar()
        cookie.name = null

		expect(cookie.name).toBeUndefined()
	})

	// // Tests that createCookie function sets property options to a cookie with no initial value
	it('create cookie with empty string', () => {
		const cookie = createCookieJar()
        cookie.name = ''
        cookie.name.set!({
            domain: 'gehenna.sh'
        })

		expect(cookie.name.toString()).toBe("")
		expect(cookie.name.property).toEqual({ domain: 'gehenna.sh' })
	})

	// // The objective of this test is to verify that the createCookie function adds property options to a non-existing cookie correctly.
	// it('should add property options to a non-existing cookie', () => {
	// 	const store = createCookieJar()
	// 	const key = 'cookie1'
	// 	const initial = 'value1'
	// 	const property = {}

	// 	const result = createCookie(store, key, initial, property)

	// 	const config = { value: 'new value', maxAge: 3600 }
	// 	result.add!(config)

	// 	expect(store[key]?.toString()).toEqual(initial.toString())
	// 	expect(store[key]?.property).toEqual({
	// 		initial,
	// 		...property,
	// 		...config
	// 	})
	// })

	// // Tests that createCookie function sets property options to a non-existing cookie
	// it('should set property options to a non-existing cookie', () => {
	// 	const store = createCookieJar()
	// 	const key = 'cookie1'
	// 	const initial = 'value1'
	// 	const property = {}

	// 	const result = createCookie(store, key, initial, property)

	// 	expect(result.property).toEqual(property)
	// })

	// // The objective of this test is to verify that the 'add' method of the createCookie function correctly updates the property options when called with a function that returns the updated options.
	// it("should update the property options when 'add' method is called with a function", () => {
	// 	const store = createCookieJar()
	// 	const key = 'cookie1'
	// 	const initial = 'value1'
	// 	const property = {}

	// 	const result = createCookie(store, key, initial, property)

	// 	const updatedProperty = { expires: new Date() }
	// 	const updatedResult = result.add!(() => updatedProperty)

	// 	expect(updatedResult.property).toEqual(updatedProperty)
	// })
})
