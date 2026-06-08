import { nullObject } from '../utils'
import type { AnySchema } from '../type'
import type { BaseCookie, CookieOptions } from './types'

export interface AppCookieConfig extends CookieOptions {
	sign?: true | string | string[]
}

export interface FieldCookieConfig {
	secrets?: string | null | (string | null)[]
	sign: boolean
	defaults?: Partial<BaseCookie>
}

export interface CompiledCookieConfig {
	defaults: Partial<BaseCookie>
	fields: Record<string, FieldCookieConfig>
	globalSign: true | string[] | undefined
	globalSecrets: string | null | (string | null)[] | undefined
	hasSign: boolean
}

const ATTRIBUTE_KEYS = new Set([
	'domain',
	'expires',
	'httpOnly',
	'maxAge',
	'path',
	'priority',
	'sameSite',
	'secure',
	'partitioned'
] as const)

function getAttributes(source: Partial<BaseCookie> | undefined) {
	if (!source) return

	const keys = Object.keys(source)
	if (!keys.length) return

	let out: Partial<BaseCookie> | undefined

	for (const key of keys)
		if (ATTRIBUTE_KEYS.has(key as any)) {
			out ??= nullObject()
			// @ts-expect-error
			out[key] = (source as any)[key]
		}

	return out
}

function normalizeSign(
	sign: true | string | string[] | undefined
): true | string[] | undefined {
	if (sign === undefined) return undefined
	if (sign === true) return true
	if (Array.isArray(sign)) return sign.length ? sign : undefined

	return [sign]
}

export function compileCookieConfig(
	routeSchema: AnySchema | undefined,
	appConfig: AppCookieConfig | undefined
): CompiledCookieConfig {
	const routeConfig: AppCookieConfig | undefined =
		(routeSchema as any)?.config ?? undefined

	const appAttributes = getAttributes(appConfig)
	const routeAttributes = getAttributes(routeConfig)

	const defaults: Partial<BaseCookie> =
		appAttributes && routeAttributes
			? {
					...getAttributes(appConfig),
					...getAttributes(routeConfig)
				}
			: (appAttributes ?? routeAttributes ?? nullObject())

	if (!defaults.path) defaults.path = '/'

	// Resolve global sign/secrets — route overrides app
	const globalSign = normalizeSign(routeConfig?.sign ?? appConfig?.sign)
	const globalSecrets =
		routeConfig?.secrets !== undefined
			? routeConfig.secrets
			: appConfig?.secrets

	const fields: Record<string, FieldCookieConfig> = nullObject()
	const properties = (routeSchema as any)?.properties as
		| Record<string, AnySchema & { config?: AppCookieConfig }>
		| undefined

	let hasSign = false
	if (properties) {
		for (const name in properties) {
			const config = (properties[name] as any)?.config as
				| AppCookieConfig
				| undefined

			if (!config) continue

			const sign = !!config.secrets || config.sign === true
			if (sign) hasSign = true

			fields[name] = {
				secrets: config.secrets,
				sign,
				defaults: getAttributes(config)
			}
		}
	}

	if (globalSign !== undefined) hasSign = true

	if (hasSign) {
		if (globalSign !== undefined && globalSecrets === undefined) {
			const fieldsWithOwnSecrets = new Set<string>()
			for (const name in fields)
				if (fields[name].secrets !== undefined)
					fieldsWithOwnSecrets.add(name)

			const fieldKeys = Object.keys(fields)

			const uncovered =
				globalSign === true
					? fieldKeys.length === 0 ||
						fieldKeys.some((n) => !fieldsWithOwnSecrets.has(n))
					: globalSign.some((n) => !fieldsWithOwnSecrets.has(n))

			if (uncovered)
				throw new Error(
					'Cookie sign is configured but no `secrets` is provided.'
				)
		}

		for (const name in fields)
			if (
				fields[name].sign &&
				fields[name].secrets === undefined &&
				globalSecrets === undefined
			)
				throw new Error(
					`Cookie field "${name}" is signed but no \`secrets\` is provided.`
				)
	}

	return {
		defaults,
		fields,
		globalSign,
		globalSecrets,
		hasSign
	}
}

const missingSecret = 'No secret is provided to cookie plugin'

export function isCookieSigned(
	name: string,
	config: CompiledCookieConfig
):
	| { signed: true; secrets: string | null | (string | null)[] }
	| { signed: false } {
	const field = config.fields[name]
	if (field?.sign) {
		const secrets = field.secrets ?? config.globalSecrets
		if (secrets === undefined) throw new Error(missingSecret)

		return { signed: true, secrets }
	}

	if (
		config.globalSign === true ||
		(Array.isArray(config.globalSign) && config.globalSign.includes(name))
	) {
		const secrets = config.globalSecrets
		if (secrets === undefined) throw new Error(missingSecret)

		return { signed: true, secrets }
	}

	return { signed: false }
}
