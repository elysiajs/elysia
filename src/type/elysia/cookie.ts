import type { TObject, TProperties, TSchema } from 'typebox'

import { ObjectType } from './object'
import type { CookieValidatorOptions } from '../types'

export type { CookieValidatorOptions } from '../types'
export interface CookieSchemaConfig extends CookieValidatorOptions {}

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
	config?: CookieSchemaConfig
}

export interface TCookieField {
	config?: CookieSchemaConfig
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
	const raw = options as Record<string, unknown> | undefined

	let configRaw: Record<string, unknown> | undefined
	let rest: Record<string, unknown> | undefined

	if (raw)
		for (const key in raw) {
			const value = raw[key]
			if (value === undefined) continue

			if ((COOKIE_OPTION_KEYS as readonly string[]).includes(key)) {
				;(configRaw ??= {})[key] = value
			} else {
				;(rest ??= {})[key] = value
			}
		}

	const config = configRaw as CookieSchemaConfig | undefined

	if (isSchema(first)) {
		if (!config) return first

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
