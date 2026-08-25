import { serialize } from './lib'
import { isNotEmpty } from '../utils'

import type { Context } from '../context'

export function serializeCookie(cookies: Context['set']['cookie']) {
	if (!cookies || !isNotEmpty(cookies)) return

	let set: string | string[] | undefined
	let isArray = false

	for (const key of Object.keys(cookies)) {
		if (!key) continue

		const property = cookies[key]
		if (!property) continue

		let value: unknown = property.value
		if (value === undefined || value === null) continue

		if (typeof value === 'object') {
			value = JSON.stringify(value)

			if ((property as any)['~raw'] === value) continue
		}

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
