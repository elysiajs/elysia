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
	hasAnySign: boolean
}

const DEFAULT_PATH = '/'

const ATTR_KEYS = [
	'domain',
	'expires',
	'httpOnly',
	'maxAge',
	'path',
	'priority',
	'sameSite',
	'secure',
	'partitioned'
] as const

function pickAttrs(source: Partial<BaseCookie> | undefined) {
	if (!source) return undefined

	let out: Partial<BaseCookie> | undefined

	for (const key of ATTR_KEYS) {
		const v = (source as any)[key]
		if (v !== undefined) ((out ??= {}) as any)[key] = v
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
	// Top-level `routeSchema.config` (from old-form `t.Cookie({...}, opts)`).
	// `t.Optional` preserves the underlying schema's properties, so `.config` is reachable.
	const routeConfig: AppCookieConfig | undefined =
		(routeSchema as any)?.config ?? undefined

	// Merge defaults: app < route
	const defaults: Partial<BaseCookie> = {
		...(pickAttrs(appConfig) ?? {}),
		...(pickAttrs(routeConfig) ?? {})
	}

	// `path` defaults to '/' when missing or empty (matches old impl + tests).
	if (!defaults.path) defaults.path = DEFAULT_PATH

	// Resolve global sign/secrets — route overrides app
	const globalSign = normalizeSign(routeConfig?.sign ?? appConfig?.sign)
	const globalSecrets =
		routeConfig?.secrets !== undefined
			? routeConfig.secrets
			: appConfig?.secrets

	// Walk per-field configs (field-form `t.Cookie(schema, opts)` inside a t.Object)
	const fields: Record<string, FieldCookieConfig> = Object.create(null)
	const properties = (routeSchema as any)?.properties as
		| Record<string, AnySchema & { config?: AppCookieConfig }>
		| undefined

	if (properties) {
		for (const name in properties) {
			const propConfig = (properties[name] as any)?.config as
				| AppCookieConfig
				| undefined
			if (!propConfig) continue

			const fieldDefaults = pickAttrs(propConfig)
			const sign = !!propConfig.secrets || propConfig.sign === true

			fields[name] = {
				secrets: propConfig.secrets,
				sign,
				defaults: fieldDefaults
			}
		}
	}

	const hasAnySign =
		globalSign !== undefined ||
		Object.values(fields).some((f) => f.sign)

	// Fail fast on misconfiguration. Anything that asks for signing must
	// have a secret reachable at the relevant scope; otherwise the cookie
	// would silently ship unsigned at request time.
	if (hasAnySign) {
		if (globalSign !== undefined && globalSecrets === undefined) {
			// At least one field is implicitly signed by the global config
			// but no global secret is set. (A field-level secret on a
			// matching name covers it; check that.)
			const fieldsWithOwnSecrets = new Set<string>()
			for (const name in fields)
				if (fields[name].secrets !== undefined)
					fieldsWithOwnSecrets.add(name)

			const uncovered =
				globalSign === true
					? Object.keys(fields).length === 0 ||
						Object.keys(fields).some(
							(n) => !fieldsWithOwnSecrets.has(n)
						)
					: globalSign.some((n) => !fieldsWithOwnSecrets.has(n))

			if (uncovered)
				throw new Error(
					'Cookie sign is configured but no `secrets` is provided. ' +
						'Add `secrets` to the cookie config or to the field via t.Cookie(schema, { secrets }).'
				)
		}

		// Each field-level sign:true entry must have either its own secret
		// or fall back to globalSecrets.
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
		hasAnySign
	}
}

export function isCookieSigned(
	name: string,
	config: CompiledCookieConfig
): { signed: true; secrets: string | null | (string | null)[] } | { signed: false } {
	const field = config.fields[name]
	if (field?.sign) {
		const secrets = field.secrets ?? config.globalSecrets
		if (secrets === undefined)
			throw new Error('No secret is provided to cookie plugin')
		return { signed: true, secrets }
	}

	if (
		config.globalSign === true ||
		(Array.isArray(config.globalSign) && config.globalSign.includes(name))
	) {
		const secrets = config.globalSecrets
		if (secrets === undefined)
			throw new Error('No secret is provided to cookie plugin')
		return { signed: true, secrets }
	}

	return { signed: false }
}
