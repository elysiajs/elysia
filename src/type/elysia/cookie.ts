import type { TObject, TProperties, TSchema } from 'typebox'

import { ObjectType } from './object'
import type { CookieValidatorOptions } from '../types'

const COOKIE_OPTION_KEYS = [
	'domain',
	'expires',
	'httpOnly',
	'maxAge',
	'path',
	'priority',
	'sameSite',
	'secure',
	'partitioned',
	'secrets',
	'sign',
	'legacySignature'
] as const

const isSchema = (value: unknown): value is TSchema =>
	!!value && typeof value === 'object' && '~kind' in (value as object)

export interface TCookieObject<T extends TProperties> extends TObject<T> {
	config?: CookieValidatorOptions
}

export interface TCookieField {
	config?: CookieValidatorOptions
}

export function Cookie<T extends TProperties>(
	properties: T,
	options?: CookieValidatorOptions
): TCookieObject<T>
export function Cookie<T extends TSchema>(
	schema: T,
	options?: CookieValidatorOptions
): T & TCookieField
export function Cookie(
	first: TProperties | TSchema,
	options?: CookieValidatorOptions
): any {
	let config: Record<string, unknown> | undefined
	let rest: Record<string, unknown> | undefined

	if (options)
		for (const key in options) {
			const value = options[key]
			if (key === 'secrets' && value == null)
				(config ??= {})['~unset'] = true

			if (value === undefined) continue

			if ((COOKIE_OPTION_KEYS as readonly string[]).includes(key))
				(config ??= {})[key] = value
			else (rest ??= {})[key] = value
		}

	if (isSchema(first)) {
		if (!config) return first

		// a wrapped t.Cookie keeps what this call leaves unset, `sign` adds up
		const inner = (first as TCookieField).config as
			| Record<string, unknown>
			| undefined

		if (inner)
			for (const key of COOKIE_OPTION_KEYS) {
				const value = inner[key]
				const own = config[key]

				if (value === undefined) continue
				if (own === undefined) config[key] = value
				else if (key === 'sign')
					config.sign =
						own === true ||
						value === true ||
						([] as unknown[]).concat(value, own)
			}

		const target = Object.create(
			Object.getPrototypeOf(first),
			Object.getOwnPropertyDescriptors(first)
		)
		target.config = config
		return target
	}

	const schema = ObjectType(first as TProperties, rest as any)
	if (config) (schema as any).config = config

	return schema
}
