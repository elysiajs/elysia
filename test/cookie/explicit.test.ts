import { describe, expect, it } from 'bun:test'
import { createCookieJar } from '../../src/cookie'
import type { Context } from '../../src/context'

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

	// Regression (perf audit F2): the jar memoizes Cookie instances per key —
	// repeated accesses must return the SAME instance instead of allocating
	// a fresh Cookie (plus re-merged defaults) per property touch
	it('memoizes Cookie instances per key', () => {
		const { cookie } = create()

		expect(cookie.name).toBe(cookie.name)
		expect(cookie.name).not.toBe(cookie.other)
	})

	// Regression (perf audit F2): read-only access through the memoized jar
	// must still not create a Set-Cookie entry
	it('read-only access does not create a set-cookie entry', () => {
		const { cookie, set } = create()

		cookie.name.value

		expect(set.cookie).toEqual({})
	})

	// Lazy write-buffer: `set.cookie` is allocated by `Cookie` only on a real
	// write, so a route that only reads (or writes an unchanged value) never
	// allocates it. Uses a `set` with no pre-set `cookie` key, mirroring the
	// real per-request `set` (where `cookie` starts `undefined`).
	it('does not allocate set.cookie until a value actually changes', () => {
		const set: Context['set'] = { headers: {} }
		const cookie = createCookieJar(set, { existing: { value: 'hi' } })

		// read-only
		expect(cookie.existing.value).toBe('hi')
		expect(set.cookie).toBeUndefined()

		// writing the SAME value back is a no-op (unchanged detection)
		cookie.existing.value = 'hi'
		expect(set.cookie).toBeUndefined()

		// a real change allocates the buffer
		cookie.existing.value = 'changed'
		expect(set.cookie).toBeDefined()
		expect(set.cookie!.existing.value).toBe('changed')
	})
})
