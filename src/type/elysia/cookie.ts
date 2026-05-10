import type { TObject, TProperties, TSchema } from 'typebox'

import { ObjectType } from './object'
import type { CookieOptions } from '../../cookie/types'

export interface CookieValidatorOptions extends CookieOptions {
	sign?: true | string | string[]
}

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
	'sign'
] as const

function extractConfig(options: Record<string, unknown> | undefined): {
	config: CookieSchemaConfig | undefined
	rest: Record<string, unknown> | undefined
} {
	if (!options) return { config: undefined, rest: undefined }

	let config: Record<string, unknown> | undefined
	let rest: Record<string, unknown> | undefined

	for (const key in options) {
		const value = (options as Record<string, unknown>)[key]
		if (value === undefined) continue

		if ((COOKIE_OPTION_KEYS as readonly string[]).includes(key)) {
			;(config ??= {})[key] = value
		} else {
			;(rest ??= {})[key] = value
		}
	}

	return {
		config: config as CookieSchemaConfig | undefined,
		rest
	}
}

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
	const { config, rest } = extractConfig(
		options as Record<string, unknown> | undefined
	)

	if (isSchema(first)) {
		// Field form: attach config. Some schemas (cached `t.Numeric()`,
		// `t.String()` empties) are frozen, so layer via prototype to avoid
		// "object is not extensible".
		if (!config) return first

		const target = Object.isExtensible(first)
			? (first as any)
			: Object.defineProperty(
					Object.create(first as object),
					'~kind',
					{ value: (first as any)['~kind'], enumerable: false }
				)
		target.config = config
		return target
	}

	// Object form: wrap properties as t.Object, attach top-level config
	const schema = ObjectType(first as TProperties, rest as any)
	if (config) (schema as any).config = config

	return schema
}
