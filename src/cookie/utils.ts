import { decodeComponent } from 'deuri'
import { parse, serialize } from './lib'

import { Cookie } from '.'
import { InvalidCookieSignature } from '../error'
import { dangerousKeys } from '../constants'
import { constantTimeEqual, isNotEmpty, nullObject } from '../utils'

import type { Context } from '../context'
import type { BaseCookie, CookieOptions } from './types'

export function createCookieJar(
	set: Context['set'],
	store: Record<string, BaseCookie>,
	initial?: Partial<BaseCookie>
): Record<string, Cookie<unknown>> {
	set.cookie ??= nullObject()

	return new Proxy(store, {
		get(_, key: string) {
			if (key in store)
				return new Cookie(
					key,
					set.cookie as Record<string, BaseCookie>,
					Object.assign(
						nullObject(),
						initial ?? nullObject(),
						store[key]
					)
				)

			return new Cookie(
				key,
				set.cookie as Record<string, BaseCookie>,
				Object.assign(nullObject(), initial)
			)
		}
	}) as Record<string, Cookie<unknown>>
}

export async function parseCookie(
	set: Context['set'],
	cookieString?: string | null,
	options?: CookieOptions & {
		sign?: true | string | string[]
	}
) {
	let {
		secrets,
		sign,
		...initial
	}: CookieOptions & {
		sign?: true | string | string[]
	} = options ?? nullObject()

	if (!cookieString) return createCookieJar(set, nullObject(), initial)

	const isStringKey = typeof secrets === 'string'
	if (sign && sign !== true && !Array.isArray(sign)) sign = [sign]

	const jar: Record<string, BaseCookie> = nullObject()

	const cookies = parse(cookieString)
	for (const [name, v] of Object.entries(cookies)) {
		if (v === undefined || dangerousKeys.has(v)) continue

		let value = decodeComponent(v)

		if (sign === true || sign?.includes(name)) {
			if (!secrets)
				throw new Error('No secret is provided to cookie plugin')

			if (isStringKey) {
				if (typeof value !== 'string')
					throw new InvalidCookieSignature(name)

				const temp = await unsignCookie(value, secrets)
				if (temp === false) throw new InvalidCookieSignature(name)

				value = temp
			} else {
				let decoded = false
				for (let i = 0; i < secrets.length; i++) {
					if (typeof value !== 'string')
						throw new InvalidCookieSignature(name)

					const temp = await unsignCookie(value, secrets[i])

					if (temp !== false) {
						decoded = true
						value = temp

						break
					}
				}

				if (!decoded) throw new InvalidCookieSignature(name)
			}
		}

		// decode cookie after unsigned
		if (value) {
			const starts = value.charCodeAt(0)

			if (starts === 123 || starts === 91)
				try {
					value = JSON.parse(value)
				} catch {}
		}

		jar[name] = { value }
	}

	return createCookieJar(set, jar, initial)
}

export function serializeCookie(cookies: Context['set']['cookie']) {
	if (!cookies || !isNotEmpty(cookies)) return undefined

	let set: string | string[] | undefined
	let isArray = false

	for (const [key, property] of Object.entries(cookies)) {
		if (!key || !property) continue

		const value = property.value
		if (value === undefined || value === null) continue

		const v = serialize(key, value, property)

		if (set) {
			if (isArray) {
				;(set as string[]).push(v)
			} else {
				set = [set as string, v]
				isArray = true
			}
		} else set = v
	}

	return set
}

const removeTrailingEquals = /=+$/g
const algorithm = { name: 'HMAC', hash: 'SHA-256' }

async function signCookie(val: string, secret: string | null) {
	if (typeof val === 'object') val = JSON.stringify(val)
	else if (typeof val !== 'string') val = val + ''

	if (secret === null || secret === undefined)
		throw new TypeError('Secret key must be provided')

	const encoder = new TextEncoder()

	const secretKey = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		algorithm,
		false,
		['sign']
	)

	const hmacBuffer = await crypto.subtle.sign(
		'HMAC',
		secretKey,
		encoder.encode(val)
	)

	return (
		val +
		'.' +
		Buffer.from(hmacBuffer)
			.toString('base64')
			.replace(removeTrailingEquals, '')
	)
}

async function unsignCookie(input: string, secret: string | null) {
	if (typeof input !== 'string')
		throw new TypeError('Signed cookie string must be provided.')

	const dot = input.lastIndexOf('.')
	if (dot === -1) {
		if (secret === null) return input

		return false
	}

	const tentativeValue = input.slice(0, dot)
	const expectedInput = await signCookie(tentativeValue, secret)

	return constantTimeEqual(expectedInput, input) ? tentativeValue : false
}
