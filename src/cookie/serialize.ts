import { serialize } from './lib'
import { isNotEmpty } from '../utils'

import type { Context } from '../context'

export function serializeCookie(cookies: Context['set']['cookie']) {
	if (!cookies || !isNotEmpty(cookies)) return

	let set: string | string[] | undefined
	let isArray = false

	for (const key in cookies) {
		if (!key) continue

		const property = cookies[key]
		if (!property) continue

		const value = property.value
		if (value === undefined || value === null) continue

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
