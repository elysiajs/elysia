import { serialize } from './lib'
import { isNotEmpty } from '../utils'

import type { Context } from '../context'
import type { BaseCookie } from './types'

export function cookieWire(cookies: object, key: string, property: BaseCookie) {
	let value: unknown = property.value
	const encode = (cookies as any)['~encode']?.[key]

	// compare before encoding: a read-only request never runs an encoder
	if (typeof value === 'object') {
		const json = JSON.stringify(value)
		if ((property as any)['~raw'] === json) return
		if (!encode) return json
	}

	// a removal's '' and an already-signed value are not decoded values
	if (
		encode &&
		!(property as any)['~remove'] &&
		(property as any)['~signed'] !== value
	)
		value = encode(value)

	return typeof value === 'object' ? JSON.stringify(value) : value
}

export function serializeCookie(cookies: Context['set']['cookie']) {
	if (!cookies || !isNotEmpty(cookies)) return

	let set: string | string[] | undefined
	let isArray = false

	for (const key of Object.keys(cookies)) {
		if (!key) continue

		const property = cookies[key]
		if (!property) continue

		if (property.value === undefined || property.value === null) continue

		const value = cookieWire(cookies, key, property)
		if (value === undefined) continue

		const v = serialize(key, value as string, property)

		if (set) {
			if (isArray) (set as string[]).push(v)
			else {
				set = [set as string, v]
				isArray = true
			}
		} else set = v
	}

	return set
}
