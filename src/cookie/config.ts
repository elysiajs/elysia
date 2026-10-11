import { compositionKeys, nullObject, refTargets } from '../utils'
import type { AnySchema } from '../type'
import type { BaseCookie, CookieOptions } from './types'
import { InvalidCookie } from './error'

export interface AppCookieConfig extends CookieOptions {
	sign?: true | string | string[]
	verify?: 'lazy' | 'eager'
}

export interface FieldCookieConfig {
	secrets?: string | null | (string | null)[]
	sign: boolean
	defaults?: Partial<BaseCookie>
	legacySignature?: boolean
}

export interface CompiledCookieConfig {
	defaults: Partial<BaseCookie>
	fields: Record<string, FieldCookieConfig>
	globalSign: true | string[] | undefined
	globalSignSet?: Set<string>
	globalSecrets: string | null | (string | null)[] | undefined
	hasSign: boolean
	verify: 'lazy' | 'eager'
	legacySignature: boolean
}

const ATTRIBUTE_KEYS = new Set<string>([
	'domain',
	'expires',
	'httpOnly',
	'maxAge',
	'path',
	'priority',
	'sameSite',
	'secure',
	'partitioned'
])

function getAttributes(source: Partial<BaseCookie> | undefined) {
	if (!source) return

	let out: Record<string, unknown> | undefined

	for (const key of Object.keys(source))
		if (ATTRIBUTE_KEYS.has(key))
			(out ??= nullObject())[key] = source[key as keyof BaseCookie]

	return out as Partial<BaseCookie> | undefined
}

// an empty secret is a real HMAC under a zero-length key, which anyone can
// reproduce — treat it as absent so signing fails loudly
const hasUsableSecret = (
	secrets: string | null | (string | null)[] | undefined
) =>
	Array.isArray(secrets)
		? secrets.some((s) => !!s?.trim())
		: !!secrets?.trim()

// cookie config, object-level and per field
interface Gathered {
	config: AppCookieConfig
	fields: Record<string, AppCookieConfig>
}

const emptyGathered = (): Gathered => ({
	config: nullObject(),
	fields: nullObject()
})

// without `sign`, sorted keys, `secrets` as a list
function comparableConfig(config: Record<string, any>) {
	const out: Record<string, unknown> = nullObject()

	for (const key of Object.keys(config).sort())
		if (key !== 'sign')
			out[key] = key === 'secrets' ? listKey(config[key]) : config[key]

	return out
}

// string key of a candidate's config ignoring `sign`, for equality
const signlessKey = (from: Gathered) => {
	const fields: Record<string, unknown> = nullObject()
	for (const name of Object.keys(from.fields).sort()) {
		const field = comparableConfig(from.fields[name])
		if (Object.keys(field).length) fields[name] = field
	}

	return JSON.stringify([comparableConfig(from.config), fields])
}

const badRefError = () =>
	new Error(
		'[Elysia] Cookie schema `$ref` is unresolvable or ambiguous; use a model name or `$id` instead'
	)

// a string and a one-item list compare equal
const listKey = (value: unknown) =>
	JSON.stringify(typeof value === 'string' ? [value] : value)

function foldConfig(into: Record<string, any>, config: any) {
	for (const key in config) {
		const value = config[key]
		const prev = into[key]

		if (value === undefined) continue
		if (prev === undefined) into[key] = value
		else if (key === 'sign')
			into.sign =
				prev === true ||
				value === true ||
				([] as unknown[]).concat(prev, value)
		else if (
			(key === 'secrets' || key === 'legacySignature') &&
			listKey(prev) !== listKey(value)
		)
			throw new Error(
				`[Elysia] Merged cookie schemas disagree on \`${key}\``
			)
	}
}

export function compileCookieConfig(
	routeSchema: AnySchema | string | undefined,
	appConfig: AppCookieConfig | undefined,
	models?: Record<string, unknown>,
	// merge guard and macro entries, outermost first
	schemas?: { cookie?: unknown }[]
): CompiledCookieConfig {
	const roots = [
		routeSchema,
		...(schemas ?? []).map((schema) => schema?.cookie).reverse()
	].map((schema) => (typeof schema === 'string' ? models?.[schema] : schema))

	let findTargets: ReturnType<typeof refTargets> | undefined
	const resolve = (name: string) =>
		(findTargets ??= refTargets(roots, models))(name)

	const gather = (
		schema: any,
		into: Gathered,
		// field name, undefined at the cookie object
		field: string | undefined,
		path: Set<unknown>
	): void => {
		if (!schema || path.has(schema)) return
		path.add(schema)

		const ref = schema.$ref
		const targets = typeof ref === 'string' ? [...resolve(ref)] : [ref]

		if (
			(typeof ref === 'string' && !targets.length) ||
			schema.$dynamicRef !== undefined ||
			schema.$recursiveRef !== undefined
		)
			throw badRefError()

		if (field === undefined) {
			foldConfig(into.config, schema.config)
			for (const name in schema.properties)
				gather(schema.properties[name], into, name, new Set())
		} else if (schema.config)
			foldConfig((into.fields[field] ??= nullObject()), schema.config)

		if (targets.length > 1) {
			// ambiguous name: candidates must agree but `sign`
			let first: string | undefined
			for (const target of targets) {
				const from = emptyGathered()
				gather(target, from, field, path)

				if ((first ??= signlessKey(from)) !== signlessKey(from))
					throw badRefError()

				foldConfig(into.config, from.config)
				for (const name in from.fields)
					foldConfig(
						(into.fields[name] ??= nullObject()),
						from.fields[name]
					)
			}
		} else gather(targets[0], into, field, path)

		for (const key of compositionKeys)
			if (Array.isArray(schema[key]))
				for (const member of schema[key])
					gather(member, into, field, path)

		// deferred action: its operand, not t.Pick / t.Omit keys
		if (schema['~kind'] === 'Deferred')
			for (const operand of [].concat(schema.parameters?.[0]))
				gather(operand, into, field, path)

		path.delete(schema)
	}

	const route = emptyGathered()
	for (const root of roots) gather(root, route, undefined, new Set())

	const routeConfig = route.config
	const fieldConfigs = route.fields

	const appAttributes = getAttributes(appConfig)
	const routeAttributes = getAttributes(routeConfig)

	const defaults: Partial<BaseCookie> =
		appAttributes && routeAttributes
			? {
					...appAttributes,
					...routeAttributes
				}
			: (appAttributes ?? routeAttributes ?? nullObject())

	if (!defaults.path) defaults.path = '/'

	const rawSign = routeConfig.sign ?? appConfig?.sign
	let globalSign: true | string[] | undefined

	if (rawSign === undefined) globalSign = undefined
	else if (rawSign === true) globalSign = true
	else if (Array.isArray(rawSign))
		globalSign = rawSign.length ? rawSign : undefined
	else globalSign = [rawSign]

	const globalSecrets =
		routeConfig.secrets !== undefined
			? routeConfig.secrets
			: appConfig?.secrets

	const fields: Record<string, FieldCookieConfig> = nullObject()

	let hasSign = false
	for (const name in fieldConfigs) {
		const config = fieldConfigs[name]

		// an empty secret fails below instead of unsigning
		const sign = config.secrets != null || config.sign === true
		if (sign) hasSign = true

		fields[name] = {
			secrets: config.secrets,
			sign,
			defaults: getAttributes(config),
			legacySignature: config.legacySignature
		}
	}

	if (globalSign !== undefined) hasSign = true

	if (hasSign) {
		if (globalSign !== undefined && !hasUsableSecret(globalSecrets)) {
			const fieldsWithOwnSecrets = new Set<string>()
			for (const name in fields)
				if (hasUsableSecret(fields[name].secrets))
					fieldsWithOwnSecrets.add(name)

			const fieldKeys = Object.keys(fields)

			const uncovered =
				globalSign === true
					? fieldKeys.length === 0 ||
						fieldKeys.some((n) => !fieldsWithOwnSecrets.has(n))
					: globalSign.some((n) => !fieldsWithOwnSecrets.has(n))

			if (uncovered) throw InvalidCookie.secret()
		}

		for (const name in fields)
			if (
				fields[name].sign &&
				!hasUsableSecret(fields[name].secrets) &&
				!hasUsableSecret(globalSecrets)
			)
				throw InvalidCookie.secret(name)
	}

	return {
		defaults,
		fields,
		globalSign,
		globalSignSet: Array.isArray(globalSign)
			? new Set(globalSign)
			: undefined,
		globalSecrets,
		hasSign,
		verify: appConfig?.verify ?? 'lazy',
		legacySignature:
			(routeConfig.legacySignature ?? appConfig?.legacySignature) !==
			false
	}
}

export const acceptsLegacySignature = (
	name: string,
	config: CompiledCookieConfig
) => config.fields[name]?.legacySignature ?? config.legacySignature

export function resolveSignSecrets(
	name: string,
	config: CompiledCookieConfig
): CompiledCookieConfig['globalSecrets'] | undefined {
	const field = config.fields[name]

	if (field?.sign) return field.secrets ?? config.globalSecrets

	if (config.globalSign === true || config.globalSignSet?.has(name) === true)
		return config.globalSecrets
}

export function isCookieSigned(
	name: string,
	config: CompiledCookieConfig
):
	| { signed: true; secrets: string | null | (string | null)[] }
	| { signed: false } {
	const secrets = resolveSignSecrets(name, config)
	if (secrets !== undefined) return { signed: true, secrets }

	if (
		config.fields[name]?.sign ||
		config.globalSign === true ||
		config.globalSignSet?.has(name) === true
	)
		throw InvalidCookie.secret()

	return { signed: false }
}
