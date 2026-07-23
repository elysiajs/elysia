import type { ElysiaAdapter } from '../../adapter'
import type { AnyElysia } from '../../base'
import {
	defaultHeaders,
	type DefaultResponseState
} from '../../adapter/default-headers'
import type { CompiledCookieConfig } from '../../cookie/config'
import type { RouteErrorFinalizer } from '../../handler/utils'
import { traceEventIndex, type TraceEvent } from '../../constants'
import {
	APP_PLAN_VERSION,
	EXTERNAL_BINDING_ROLES,
	type AppPlan,
	type ExternalBindingInput,
	type ExternalBindingRole,
	type HttpHandlerForm,
	type HttpRoutePlan,
	type HttpRoutePlanInput,
	type LifecycleBindingInput,
	type LifecyclePhase,
	type LifecycleSegmentReference,
	type ValidatorSlotInput
} from '../app-plan'
import { readRouteQueryPlan, type RouteValidator } from '../../validator/route'
import type { ValidatorSlot } from '../aot'
import {
	createValidatorSlotInput,
	VALIDATOR_SEMANTICS_VERSION,
	validatorArtifactSettlement,
	validatorSemantics,
	type ValidatorExecutorBinding
} from '../validator-semantics'
import { deriveModes } from './utils'
import { RouteEffect, type RouteCompileState } from './descriptor'
import type { CompactBeforeHandlePrefix } from '../../utils'
import type { AnyLocalHook } from '../../types'

export const BALANCED_HTTP_PROGRAM_VERSION = 2 as const
export const BALANCED_HTTP_PROGRAM_KIND = 'balanced-http' as const

export const ResponseSink = {
	Compact: 0,
	Set: 1,
	DefaultHeaders: 2,
	SetWithDefaultHeaders: 3
} as const

export type ResponseSink = (typeof ResponseSink)[keyof typeof ResponseSink]

export interface BalancedHttpRouteInput {
	method: string
	path: string
	handler: unknown
	root: AnyElysia
	hook: AnyLocalHook | undefined
	state: RouteCompileState
}

type AnyFn = (...args: any[]) => any
type BeforeMode = -1 | 0 | 1

export interface BalancedHttpBodyProgram {
	readonly enabled: boolean
	readonly mode: 'none' | 'builtin' | 'chain' | 'default'
	readonly builtin: string | null
	readonly parserCount: number
	readonly parsers: readonly (string | null)[]
	readonly parserNames: readonly string[]
	readonly custom: boolean
	readonly fallback: boolean
	readonly mediaKind: 0 | 1 | 2 | 3
	readonly presence: 'none' | 'content-type' | 'framing'
}

type BalancedCookieAttribute =
	| 'domain'
	| 'expires'
	| 'httpOnly'
	| 'maxAge'
	| 'path'
	| 'priority'
	| 'sameSite'
	| 'secure'
	| 'partitioned'

type BalancedCookieAttributeValue = string | number | boolean
type BalancedCookieDefaults = readonly (readonly [
	BalancedCookieAttribute,
	BalancedCookieAttributeValue
])[]

export interface BalancedCookieProgram {
	readonly optional: boolean
	readonly hasSign: boolean
	readonly syncSign: boolean
	readonly lazyVerify: boolean
	readonly defaults: BalancedCookieDefaults
	readonly fields: readonly {
		readonly name: string
		readonly sign: boolean
		readonly defaults: BalancedCookieDefaults
		readonly hasSecrets: boolean
	}[]
	readonly globalSign: true | readonly string[] | null
	readonly hasGlobalSecrets: boolean
	readonly verify: 'lazy' | 'eager'
}

export interface BalancedHttpProgram {
	readonly kind: typeof BALANCED_HTTP_PROGRAM_KIND
	readonly responseSink: ResponseSink
	readonly contextMode: 'compact' | 'set'
	readonly effectMask: number
	readonly headerKeys: readonly string[] | null
	readonly body: BalancedHttpBodyProgram
	readonly hooks: {
		readonly transforms: number
		readonly beforePrefix: number
		readonly before: number
		readonly after: number
		readonly map: number
		readonly afterResponse: number
		readonly error: number
	}
	readonly validators: readonly string[]
	readonly cookie: BalancedCookieProgram | null
	readonly trace: null | {
		readonly count: number
		readonly phases: number
		readonly handlerName: string
	}
	readonly defaultHeaders: readonly (readonly [string, string])[] | null
	readonly validationPlan: boolean
	readonly allowUnsafeValidationDetails: boolean
}

export type BalancedHttpUnsupportedReason =
	| 'invalid-handler'
	| 'missing-default-response-state'
	| 'lazy-precompile-false'
	| 'compat-cancellation'
	| 'unsupported-parser'
	| 'unsupported-validator-slot'
	| 'invalid-cookie-policy'

export class BalancedHttpUnsupportedError extends Error {
	readonly code = 'BALANCED_HTTP_UNSUPPORTED'

	constructor(
		readonly method: string,
		readonly path: string,
		readonly reason: BalancedHttpUnsupportedReason
	) {
		super(`Balanced HTTP route ${method} ${path} is unsupported: ${reason}`)
		this.name = 'BalancedHttpUnsupportedError'
	}
}

export type BalancedHttpPlanResult =
	| { readonly supported: true; readonly route: HttpRoutePlanInput }
	| {
			readonly supported: false
			readonly method: string
			readonly path: string
			readonly reason: BalancedHttpUnsupportedReason
	  }

export interface BalancedHttpHooks {
	readonly transforms: BalancedLifecycleSequence
	readonly before: BalancedLifecycleSequence
	readonly after: BalancedLifecycleSequence
	readonly map: BalancedLifecycleSequence
	readonly afterResponse: BalancedLifecycleSequence
	readonly error: BalancedLifecycleSequence
}

export interface BalancedLifecycleEntry {
	readonly role: LifecycleBindingInput['role']
	readonly name: string
	readonly value: AnyFn
}
export interface BalancedLifecycleSequence
	extends Iterable<BalancedLifecycleEntry> {
	readonly length: number
}

interface BalancedLifecycleBlock {
	readonly length: number
	readonly entry?: BalancedLifecycleEntry
	readonly left?: BalancedLifecycleBlock
	readonly right?: BalancedLifecycleBlock
}
interface BalancedLifecycleSequenceImage extends BalancedLifecycleSequence {
	readonly blocks: readonly BalancedLifecycleBlock[]
}

function* iterateLifecycleBlock(
	block: BalancedLifecycleBlock
): IterableIterator<BalancedLifecycleEntry> {
	if (block.entry) {
		yield block.entry
		return
	}
	yield* iterateLifecycleBlock(block.left!)
	yield* iterateLifecycleBlock(block.right!)
}

const lifecycleSequence = (
	blocks: readonly BalancedLifecycleBlock[],
	length: number
): BalancedLifecycleSequenceImage =>
	Object.freeze({
		length,
		blocks: Object.freeze(blocks),
		*[Symbol.iterator]() {
			for (const block of blocks) yield* iterateLifecycleBlock(block)
		}
	})

const EMPTY_LIFECYCLE_SEQUENCE = lifecycleSequence([], 0)
const EMPTY_RUNTIME_VALUES = Object.freeze([]) as readonly never[]
const EMPTY_HTTP_HOOKS: BalancedHttpHooks = Object.freeze({
	transforms: EMPTY_LIFECYCLE_SEQUENCE,
	before: EMPTY_LIFECYCLE_SEQUENCE,
	after: EMPTY_LIFECYCLE_SEQUENCE,
	map: EMPTY_LIFECYCLE_SEQUENCE,
	afterResponse: EMPTY_LIFECYCLE_SEQUENCE,
	error: EMPTY_LIFECYCLE_SEQUENCE
})

const appendLifecycleSequence = (
	sequence: BalancedLifecycleSequenceImage,
	entry: BalancedLifecycleEntry
) => {
	const blocks = [...sequence.blocks]
	let block: BalancedLifecycleBlock = Object.freeze({ length: 1, entry })
	while (blocks.at(-1)?.length === block.length) {
		const left = blocks.pop()!
		block = Object.freeze({
			length: left.length + block.length,
			left,
			right: block
		})
	}
	blocks.push(block)
	return lifecycleSequence(blocks, sequence.length + 1)
}

export interface BalancedHttpRuntimePlan {
	readonly version: typeof BALANCED_HTTP_PROGRAM_VERSION
	readonly path: string
	readonly handlerForm: HttpHandlerForm
	readonly handler: unknown
	readonly adapter: ElysiaAdapter
	readonly program: BalancedHttpProgram
	readonly bodyParserHooks: readonly unknown[] | undefined
	readonly validators: RouteValidator<any> | undefined
	readonly cookieConfig: CompiledCookieConfig | undefined
	readonly hooks: BalancedHttpHooks
	readonly finalizeError: RouteErrorFinalizer | undefined
	readonly defaultResponseState: DefaultResponseState | undefined
	readonly maybeValidatorSlots: readonly string[]
	readonly tracers: readonly AnyFn[]
}

export function balancedAdapterPlan(adapter: ElysiaAdapter) {
	const parse = Object.freeze({
		json: adapter.parse.json,
		text: adapter.parse.text,
		urlencoded: adapter.parse.urlencoded,
		arrayBuffer: adapter.parse.arrayBuffer,
		formData: adapter.parse.formData,
		default: adapter.parse.default
	})
	return Object.freeze({
		adapter: {
			target: adapter.name,
			capabilities: {
				isWebStandard: adapter.isWebStandard,
				websocket: adapter.websocket === true,
				defaultHeaders:
					adapter.response.supportsDefaultHeaderSink === true,
				compact: typeof adapter.response.compact === 'function'
			}
		},
		bindings: Object.freeze([
			{ role: 'adapterParse' as const, value: parse },
			{ role: 'adapterMap' as const, value: adapter.response.map },
			...(adapter.response.compact
				? [
						{
							role: 'adapterCompact' as const,
							value: adapter.response.compact
						}
					]
				: [])
		])
	})
}

const builtinParsers = new Set([
	'formdata',
	'multipart/form-data',
	'json',
	'application/json',
	'urlencoded',
	'application/x-www-form-urlencoded',
	'arrayBuffer',
	'application/octet-stream',
	'text',
	'text/plain',
	'none'
])

const parserSupported = (parser: unknown) =>
	typeof parser === 'function' ||
	(typeof parser === 'string' &&
		parser.length > 0 &&
		builtinParsers.has(parser))

const values = (value: unknown): readonly AnyFn[] =>
	value == null ? [] : ((Array.isArray(value) ? value : [value]) as AnyFn[])

const bindingName = (value: unknown) =>
	(typeof (value as any)?.name === 'string' && (value as any).name) ||
	'anonymous'

const handlerForm = (
	options: BalancedHttpRouteInput & { handlerForm?: HttpHandlerForm }
): HttpHandlerForm =>
	options.handlerForm ??
	(options.state.descriptor.handlerKind === 'function'
		? 'function'
		: options.state.descriptor.handlerKind === 'response'
			? 'response'
			: options.state.descriptor.handlerKind === 'promise'
				? 'promise'
				: 'static-value')

const handlerForms = new Set<HttpHandlerForm>([
	'function',
	'response',
	'static-value',
	'promise',
	'mount'
])

const isThenable = (value: unknown) => {
	if (
		value === null ||
		(typeof value !== 'object' && typeof value !== 'function')
	)
		return false
	try {
		return typeof (value as any).then === 'function'
	} catch {
		return false
	}
}

const handlerRole = (form: HttpHandlerForm): ExternalBindingRole =>
	form === 'mount'
		? 'mount'
		: form === 'function'
			? 'handler'
			: form === 'response'
				? 'response'
				: 'staticValue'

const canonicalValidatorSlot = (slot: string) => {
	if (/^(?:body|headers|params|query|cookie)$/.test(slot)) return true
	if (!slot.startsWith('response:')) return false
	const status = slot.slice(9)
	if (!/^(?:0|[1-9]\d*)$/.test(status)) return false
	const numeric = Number(status)
	return Number.isSafeInteger(numeric) && String(numeric) === status
}

const cookieAttributes: readonly BalancedCookieAttribute[] = [
	'domain',
	'expires',
	'httpOnly',
	'maxAge',
	'path',
	'priority',
	'sameSite',
	'secure',
	'partitioned'
]

const validCookieAttribute = (key: BalancedCookieAttribute, value: unknown) => {
	switch (key) {
		case 'domain':
		case 'path':
			return typeof value === 'string'
		case 'priority':
			return value === 'low' || value === 'medium' || value === 'high'
		case 'sameSite':
			return (
				typeof value === 'boolean' ||
				value === 'lax' ||
				value === 'strict' ||
				value === 'none'
			)
		case 'httpOnly':
		case 'secure':
		case 'partitioned':
			return typeof value === 'boolean'
		case 'expires':
		case 'maxAge':
			return typeof value === 'number' && Number.isFinite(value)
	}
}

const encodeCookieDefaults = (
	defaults: Record<string, unknown> | undefined
): BalancedCookieDefaults => {
	const entries: Array<
		readonly [BalancedCookieAttribute, BalancedCookieAttributeValue]
	> = []
	for (const key of cookieAttributes) {
		let value = defaults?.[key]
		if (value === undefined) continue
		if (key === 'expires') {
			if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
				throw new Error('invalid cookie expires policy')
			value = value.getTime()
		}
		if (!validCookieAttribute(key, value))
			throw new Error(`invalid cookie ${key} policy`)
		entries.push([key, value as BalancedCookieAttributeValue])
	}
	return entries
}

const planCookieConfig = (
	config: CompiledCookieConfig,
	semantic: Pick<BalancedCookieProgram, 'optional' | 'syncSign' | 'lazyVerify'>
) => {
	const secrets: unknown[] = []
	const hasGlobalSecrets = config.globalSecrets !== undefined
	if (hasGlobalSecrets) secrets.push(config.globalSecrets)
	const fields = Object.keys(config.fields)
		.sort()
		.map((name) => {
			const field = config.fields[name]!
			const hasSecrets = field.secrets !== undefined
			if (hasSecrets) secrets.push(field.secrets)
			return {
				name,
				sign: field.sign,
				defaults: encodeCookieDefaults(field.defaults as any),
				hasSecrets
			}
		})
	return {
		program: {
			...semantic,
			hasSign: config.hasSign,
			defaults: encodeCookieDefaults(config.defaults as any),
			fields,
			globalSign:
				config.globalSign === undefined
					? null
					: config.globalSign === true
						? true
						: [...new Set(config.globalSign)].sort(),
			hasGlobalSecrets,
			verify: config.verify
		} satisfies BalancedCookieProgram,
		secrets
	}
}

const decodeCookieDefaults = (defaults: BalancedCookieDefaults) => {
	const out: Record<string, unknown> = Object.create(null)
	for (const [key, encoded] of defaults)
		out[key] = key === 'expires' ? new Date(encoded as number) : encoded
	return Object.freeze(out)
}

const validCookieDefaults = (defaults: unknown) => {
	if (!Array.isArray(defaults)) return false
	let previous = -1
	for (const entry of defaults) {
		if (!Array.isArray(entry) || entry.length !== 2) return false
		const [key, value] = entry
		const index = cookieAttributes.indexOf(key)
		if (index <= previous) return false
		previous = index
		if (!validCookieAttribute(key, value)) return false
	}
	return true
}

const validGlobalCookieSign = (value: unknown) =>
	value === null ||
	value === true ||
	(Array.isArray(value) &&
		value.length > 0 &&
		value.every(
			(name, index) =>
				typeof name === 'string' &&
				name.length > 0 &&
				(index === 0 || value[index - 1]! < name)
		))

const phaseMask = (phases: ReadonlySet<TraceEvent> | null) => {
	if (phases === null) return (1 << 9) - 1
	let mask = 0
	for (const phase of phases) mask |= 1 << traceEventIndex[phase]
	return mask
}

const validatorInputs = (
	options: BalancedHttpRouteInput
): ValidatorSlotInput[] | undefined => {
	const validator = options.state.vali
	if (!validator) return
	const out: ValidatorSlotInput[] = []
	const add = (
		slot: 'body' | 'headers' | 'params' | 'query' | 'cookie',
		value: unknown
	) => {
		if (!value) return
		out.push(
			createValidatorSlotInput(slot, validatorSemantics(value as object), {
				validator: value as object,
				queryPlan: slot === 'query' ? readRouteQueryPlan(validator) : undefined
			})
		)
	}
	add('body', validator.body)
	add('headers', validator.headers)
	add('params', validator.params)
	add('query', validator.query)
	add('cookie', validator.cookie)
	if (validator.response)
		for (const status of Object.keys(validator.response).sort(
			(a, b) => Number(a) - Number(b)
		)) {
			if (!canonicalValidatorSlot(`response:${status}`)) return undefined
			const value = validator.response[Number(status)]
			out.push(
				createValidatorSlotInput(
					`response:${status}` as ValidatorSlot,
					validatorSemantics(value as object),
					{ validator: value as object }
				)
			)
		}
	return out
}

export function planBalancedHttpRoute(
	options: BalancedHttpRouteInput & { handlerForm?: HttpHandlerForm }
): BalancedHttpPlanResult {
	const { descriptor } = options.state
	const unsupported = (
		reason: BalancedHttpUnsupportedReason
	): BalancedHttpPlanResult => ({
		supported: false,
		method: options.method,
		path: options.path,
		reason
	})

	if (
		(descriptor.bodyPlan.builtin !== null &&
			!parserSupported(descriptor.bodyPlan.builtin)) ||
		options.state.bodyParserHooks?.some((parser) => !parserSupported(parser))
	)
		return unsupported('unsupported-parser')

	const form = handlerForm(options)
	if (
		!handlerForms.has(form) ||
		((form === 'function' || form === 'mount') &&
			typeof options.handler !== 'function') ||
		(form === 'response' && !(options.handler instanceof Response)) ||
		(form === 'promise' && !isThenable(options.handler))
	)
		return unsupported('invalid-handler')
	if (
		descriptor.responseMode === 'default-headers' &&
		!options.state.defaultResponseState
	)
		return unsupported('missing-default-response-state')

	let validators: ValidatorSlotInput[] | undefined
	try {
		validators = validatorInputs(options)
	} catch {
		return unsupported('unsupported-validator-slot')
	}
	if (options.state.vali?.response && validators === undefined)
		return unsupported('unsupported-validator-slot')
	let cookiePlan: ReturnType<typeof planCookieConfig> | undefined
	if (options.state.cookieConfig)
		try {
			cookiePlan = planCookieConfig(options.state.cookieConfig, {
				optional: !!(options.hook?.cookie as any)?.['~optional'],
				syncSign: descriptor.syncCookieSign,
				lazyVerify: descriptor.lazyCookieVerify
			})
		} catch {
			return unsupported('invalid-cookie-policy')
		}
	const bindings: ExternalBindingInput[] = []
	const bind = (role: ExternalBindingRole, value: unknown) => {
		bindings.push({ role, value })
	}
	const parserTokens = (options.state.bodyParserHooks ?? []).map((parser) => {
		if (typeof parser === 'string') return parser
		bind('parser', parser)
		return null
	})

	const transforms = values(options.hook?.transform)
	const prefix = options.state.beforeHandlePrefix
	const compactPrefix = !!prefix && !Array.isArray(prefix)
	const prefixValues = compactPrefix
		? []
		: values(prefix as readonly Function[] | undefined)
	const before = values(options.hook?.beforeHandle)
	const modes = deriveModes(
		before as unknown as Function[],
		(options.hook as any)?.['~deriveEntries']
	)
	const beforeModes = before.map((_fn, index) => {
		const mode = modes?.[index]
		return mode === undefined ? -1 : mode ? 1 : 0
	}) as BeforeMode[]
	const after = values(options.hook?.afterHandle)
	const map = values(options.hook?.mapResponse)
	const afterResponse = values(options.hook?.afterResponse)
	const error = values(options.hook?.error)
	const tracers = values(options.state.traceHandlers)
	for (const fn of tracers) bind('tracer', fn)

	const validationPlan = !!options.root['~config']?.experimental?.validationPlan
	for (const secret of cookiePlan?.secrets ?? [])
		bind('cookieCryptoProvider', secret)

	const responseSink =
		descriptor.responseMode === 'compact'
			? ResponseSink.Compact
			: descriptor.responseMode === 'default-headers'
				? ResponseSink.DefaultHeaders
				: descriptor.responseMode === 'set-with-default-headers'
					? descriptor.effectMask & RouteEffect.SetHeaders
						? ResponseSink.SetWithDefaultHeaders
						: ResponseSink.Set
					: ResponseSink.Set
	const defaultState = options.state.defaultResponseState
	const program: BalancedHttpProgram = {
		kind: BALANCED_HTTP_PROGRAM_KIND,
		responseSink,
		contextMode: descriptor.contextMode,
		effectMask: descriptor.effectMask,
		headerKeys:
			descriptor.headerKeys === null ? null : [...descriptor.headerKeys],
		body: {
			enabled: descriptor.bodyPlan.enabled,
			mode: descriptor.bodyPlan.mode,
			builtin: descriptor.bodyPlan.builtin,
			parserCount: descriptor.bodyPlan.parserCount,
			parsers: parserTokens,
			parserNames: (options.state.bodyParserHooks ?? []).map((parser) =>
				typeof parser === 'string' ? parser : 'anonymous'
			),
			custom: descriptor.bodyPlan.custom,
			fallback: descriptor.bodyPlan.fallback,
			mediaKind: descriptor.bodyPlan.mediaKind,
			presence: descriptor.bodyPlan.presence
		},
		hooks: {
			transforms: transforms.length,
			beforePrefix: prefix?.length ?? 0,
			before: before.length,
			after: after.length,
			map: map.length,
			afterResponse: afterResponse.length,
			error: error.length
		},
		validators: (validators ?? []).map((validator) => validator.slot).sort(),
		cookie: cookiePlan?.program ?? null,
		trace: tracers.length
			? {
					count: tracers.length,
					phases: phaseMask(options.state.tracePhases),
					handlerName: 'anonymous'
				}
			: null,
		defaultHeaders: defaultState
			? Object.entries(defaultState.headers).map(([key, value]) => [key, value])
			: null,
		validationPlan,
		allowUnsafeValidationDetails:
			options.root['~config']?.allowUnsafeValidationDetails === true
	}

	return {
		supported: true,
		route: {
			method: options.method,
			path: options.path,
			handlerForm: form,
			program: {
				version: BALANCED_HTTP_PROGRAM_VERSION,
				content: program,
				bindings: [{ role: handlerRole(form), value: options.handler }]
			},
			bindings,
			lifecycle: [
				{
					phase: 'transform',
					bindings: transforms.map((value) => ({
						role: 'transform' as const,
						value
					}))
				},
				{
					phase: 'beforeHandle',
					prefix: compactPrefix
						? (prefix as CompactBeforeHandlePrefix)
						: undefined,
					bindings: [
						...prefixValues.map((value) => ({
							role: 'beforeHandle' as const,
							value
						})),
						...before.map((value, index) => ({
							role:
								beforeModes[index] === -1
									? ('beforeHandle' as const)
									: beforeModes[index] === 1
										? ('resolve' as const)
										: ('derive' as const),
							value
						}))
					]
				},
				...([
					['afterHandle', 'afterHandle', after],
					['mapResponse', 'mapResponse', map],
					['afterResponse', 'afterResponse', afterResponse],
					['error', 'error', error]
				] as const).map(([phase, role, values]) => ({
					phase,
					bindings: values.map((value) => ({ role, value }))
				}))
			],
			validators
		}
	}
}

export function sealBalancedHttpRoutes(
	results: readonly BalancedHttpPlanResult[],
	winningRouteCount: number
): readonly HttpRoutePlanInput[] {
	for (const result of results)
		if (!result.supported)
			throw new BalancedHttpUnsupportedError(
				result.method,
				result.path,
				result.reason
			)

	if (results.length !== winningRouteCount)
		throw new Error(
			`[BALANCED_HTTP_COVERAGE] planned ${results.length}/${winningRouteCount} winning routes`
		)

	return Object.freeze(
		results.map((result) => (result as { route: HttpRoutePlanInput }).route)
	)
}

const integer = (value: unknown) =>
	typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

export function assertBalancedHttpProgram(
	value: unknown
): asserts value is BalancedHttpProgram {
	const program = value as BalancedHttpProgram
	const exactKeys = (input: unknown, expected: readonly string[]) =>
		!!input &&
		typeof input === 'object' &&
		!Array.isArray(input) &&
		Object.keys(input as object)
			.sort()
			.join('\0') === [...expected].sort().join('\0')
	const names = (values: unknown) =>
		Array.isArray(values) &&
		values.every((name) => typeof name === 'string' && name.length > 0)
	const countNames = (count: unknown, values: unknown) =>
		integer(count) && names(values) && count === (values as unknown[]).length
	const bool = (input: unknown) => typeof input === 'boolean'
	const body = program?.body
	const hooks = program?.hooks
	const bodyModes = new Set(['none', 'builtin', 'chain', 'default'])
	const bodyPresence = new Set(['none', 'content-type', 'framing'])
	const bodyTokens =
		Array.isArray(body?.parsers) &&
		body.parsers.every(
			(parser) =>
				parser === null ||
				(typeof parser === 'string' && parserSupported(parser))
		)
	const noBody =
		body?.enabled === false &&
		body.mode === 'none' &&
		body.builtin === null &&
		body.parserCount === 0 &&
		body.parsers.length === 0 &&
		body.custom === false &&
		body.fallback === false &&
		body.mediaKind === 0 &&
		body.presence === 'none'
	const builtinBody =
		body?.enabled === true &&
		body.mode === 'builtin' &&
		typeof body.builtin === 'string' &&
		parserSupported(body.builtin) &&
		body.parserCount === 1 &&
		body.parsers.length === 0 &&
		body.custom === false &&
		body.fallback === false &&
		body.mediaKind === 0 &&
		body.presence === 'none'
	const chainBody =
		body?.enabled === true &&
		body.mode === 'chain' &&
		body.builtin === null &&
		body.parsers.length > 0 &&
		body.parserCount === body.parsers.length &&
		body.custom === body.parsers.includes(null) &&
		body.fallback ===
			!body.parsers.some((parser) => typeof parser === 'string') &&
		(body.custom === false || body.mediaKind === 0) &&
		(body.fallback
			? body.presence === 'content-type' || body.presence === 'framing'
			: body.presence === 'none')
	const defaultBody =
		body?.enabled === true &&
		body.mode === 'default' &&
		body.builtin === null &&
		body.parserCount === 0 &&
		body.parsers.length === 0 &&
		body.custom === false &&
		body.fallback === true &&
		(body.presence === 'content-type' || body.presence === 'framing')
	const validators = program?.validators
	const validatorList =
		Array.isArray(validators) &&
		validators.every(
			(slot, index) =>
				typeof slot === 'string' &&
				canonicalValidatorSlot(slot) &&
				(index === 0 || validators[index - 1]! < slot)
		)
	const defaultHeaders = program?.defaultHeaders
	const defaultHeaderList =
		defaultHeaders === null ||
		(Array.isArray(defaultHeaders) &&
			defaultHeaders.length > 0 &&
			defaultHeaders.every(
				(entry) =>
					Array.isArray(entry) &&
					entry.length === 2 &&
					typeof entry[0] === 'string' &&
					entry[0].length > 0 &&
					typeof entry[1] === 'string'
			) &&
			new Set(defaultHeaders.map(([key]) => key)).size ===
				defaultHeaders.length)
	const setSink =
		program?.responseSink === ResponseSink.Set ||
		program?.responseSink === ResponseSink.SetWithDefaultHeaders
	const defaultSink =
		program?.responseSink === ResponseSink.DefaultHeaders ||
		program?.responseSink === ResponseSink.SetWithDefaultHeaders
	const cookie = program?.cookie
	const cookieProgram =
		cookie === null ||
		(!!cookie &&
			exactKeys(cookie, [
				'optional',
				'hasSign',
				'syncSign',
				'lazyVerify',
				'defaults',
				'fields',
				'globalSign',
				'hasGlobalSecrets',
				'verify'
			]) &&
			bool(cookie.optional) &&
			bool(cookie.hasSign) &&
			bool(cookie.syncSign) &&
			(!cookie.syncSign || cookie.hasSign) &&
			bool(cookie.lazyVerify) &&
			validCookieDefaults(cookie.defaults) &&
			Array.isArray(cookie.fields) &&
			cookie.fields.every(
				(field, index) =>
					!!field &&
					exactKeys(field, ['name', 'sign', 'defaults', 'hasSecrets']) &&
					typeof field.name === 'string' &&
					field.name.length > 0 &&
					(index === 0 || cookie.fields[index - 1]!.name < field.name) &&
					bool(field.sign) &&
					bool(field.hasSecrets) &&
					validCookieDefaults(field.defaults)
			) &&
			validGlobalCookieSign(cookie.globalSign) &&
			cookie.hasSign ===
				(cookie.globalSign !== null ||
					cookie.fields.some((field) => field.sign)) &&
			bool(cookie.hasGlobalSecrets) &&
			(cookie.verify === 'lazy' || cookie.verify === 'eager'))
	if (
		!program ||
		typeof program !== 'object' ||
		!exactKeys(program, [
			'kind',
			'responseSink',
			'contextMode',
			'effectMask',
			'headerKeys',
			'body',
			'hooks',
			'validators',
			'cookie',
			'trace',
			'defaultHeaders',
			'validationPlan',
			'allowUnsafeValidationDetails'
		]) ||
		program.kind !== BALANCED_HTTP_PROGRAM_KIND ||
		!integer(program.responseSink) ||
		program.responseSink < ResponseSink.Compact ||
		program.responseSink > ResponseSink.SetWithDefaultHeaders ||
		(program.contextMode !== 'compact' && program.contextMode !== 'set') ||
		program.contextMode !== (setSink ? 'set' : 'compact') ||
		!integer(program.effectMask) ||
		program.effectMask >
			(RouteEffect.Query |
				RouteEffect.Headers |
				RouteEffect.Route |
				RouteEffect.SetHeaders) ||
		(program.headerKeys !== null &&
			(!Array.isArray(program.headerKeys) ||
				program.headerKeys.some(
					(key) => typeof key !== 'string' || key.length === 0
				) ||
				new Set(program.headerKeys).size !== program.headerKeys.length)) ||
		!body ||
		!exactKeys(body, [
			'enabled',
			'mode',
			'builtin',
			'parserCount',
			'parsers',
			'parserNames',
			'custom',
			'fallback',
			'mediaKind',
			'presence'
		]) ||
		!bodyModes.has(body.mode) ||
		!bodyPresence.has(body.presence) ||
		!integer(body.parserCount) ||
		!bodyTokens ||
		!names(body.parserNames) ||
		body.parsers.length !== body.parserNames.length ||
		!bool(body.custom) ||
		!bool(body.fallback) ||
		!integer(body.mediaKind) ||
		body.mediaKind > 3 ||
		(!noBody && !builtinBody && !chainBody && !defaultBody) ||
		!hooks ||
		!exactKeys(hooks, [
			'transforms',
			'beforePrefix',
			'before',
			'after',
			'map',
			'afterResponse',
			'error'
		]) ||
		!integer(hooks.transforms) ||
		!integer(hooks.beforePrefix) ||
		!integer(hooks.before) ||
		!integer(hooks.after) ||
		!integer(hooks.map) ||
		!integer(hooks.afterResponse) ||
		!integer(hooks.error) ||
		!validatorList ||
		!cookieProgram ||
		(program.trace !== null &&
			(!program.trace ||
				!exactKeys(program.trace, ['count', 'phases', 'handlerName']) ||
				!integer(program.trace.count) ||
				program.trace.count === 0 ||
				!integer(program.trace.phases) ||
				program.trace.phases > (1 << 9) - 1 ||
				typeof program.trace.handlerName !== 'string' ||
				program.trace.handlerName.length === 0)) ||
		!defaultHeaderList ||
		(defaultSink && defaultHeaders === null) ||
		(program.responseSink === ResponseSink.Compact &&
			defaultHeaders !== null) ||
		(program.responseSink === ResponseSink.SetWithDefaultHeaders &&
			!(program.effectMask & RouteEffect.SetHeaders)) ||
		!bool(program.validationPlan) ||
		!bool(program.allowUnsafeValidationDetails)
	)
		throw new Error('[BALANCED_HTTP_PROGRAM] invalid program content')
}

const expectedRole = (slot: string): ExternalBindingRole =>
	slot.startsWith('response:')
		? 'responseValidator'
		: (`${slot}Validator` as ExternalBindingRole)

const bindingRoles = new Set<ExternalBindingRole>(EXTERNAL_BINDING_ROLES)
const lifecycleBindingRoles = new Set<ExternalBindingRole>([
	'transform',
	'derive',
	'resolve',
	'beforeHandle',
	'afterHandle',
	'mapResponse',
	'afterResponse',
	'error'
])
const lifecycleRolePhase = (
	role: ExternalBindingRole
): LifecyclePhase | undefined => {
	if (role === 'transform') return 'transform'
	if (role === 'derive' || role === 'resolve' || role === 'beforeHandle')
		return 'beforeHandle'
	if (
		role === 'afterHandle' ||
		role === 'mapResponse' ||
		role === 'afterResponse' ||
		role === 'error'
	)
		return role
}

function lowerBalancedAdapter(
	appPlan: AppPlan,
	ambient?: ElysiaAdapter
): ElysiaAdapter {
	const byRole = (role: ExternalBindingRole) =>
		appPlan.application.bindingIndices.filter(
			(index) => appPlan.bindingLayout[index]?.role === role
		)
	const one = (role: ExternalBindingRole, required = true) => {
		const indices = byRole(role)
		if (indices.length !== (required ? 1 : 0))
			throw new Error(`[BALANCED_HTTP_BINDING] invalid application ${role}`)
		return indices.length ? appPlan.externalBindings[indices[0]!] : undefined
	}
	const parse = one('adapterParse') as ElysiaAdapter['parse']
	const map = one('adapterMap') as ElysiaAdapter['response']['map']
	const compactCapability = appPlan.adapter.capabilities.compact === true
	const compact = one('adapterCompact', compactCapability) as
		| ElysiaAdapter['response']['compact']
		| undefined
	if (
		!parse ||
		typeof parse !== 'object' ||
		[
			'json',
			'text',
			'urlencoded',
			'arrayBuffer',
			'formData',
			'default'
		].some((key) => typeof (parse as any)[key] !== 'function') ||
		typeof map !== 'function' ||
		(compactCapability && typeof compact !== 'function')
	)
		throw new Error('[BALANCED_HTTP_BINDING] invalid adapter callbacks')

	if (ambient) {
		if (
			ambient.name !== appPlan.adapter.target ||
			ambient.parse.json !== parse.json ||
			ambient.parse.text !== parse.text ||
			ambient.parse.urlencoded !== parse.urlencoded ||
			ambient.parse.arrayBuffer !== parse.arrayBuffer ||
			ambient.parse.formData !== parse.formData ||
			ambient.parse.default !== parse.default ||
			ambient.response.map !== map ||
			ambient.response.compact !== compact
		)
			throw new Error('[BALANCED_HTTP_BINDING] ambient adapter mismatch')
	}

	return Object.freeze({
		name: appPlan.adapter.target,
		runtime: appPlan.adapter.target as ElysiaAdapter['runtime'],
		isWebStandard: appPlan.adapter.capabilities.isWebStandard === true,
		websocket: appPlan.adapter.capabilities.websocket === true,
		parse,
		response: Object.freeze({
			map,
			compact,
			supportsDefaultHeaderSink: appPlan.adapter.capabilities.defaultHeaders
				? true
				: undefined
		})
	}) as ElysiaAdapter
}

function assertBalancedHttpBindingImage(appPlan: AppPlan) {
	if (appPlan.version !== APP_PLAN_VERSION)
		throw new Error(
			`[BALANCED_HTTP_APP_PLAN] unsupported version ${String(appPlan.version)}`
		)

	const { coverage, bindingLayout, externalBindings } = appPlan
	if (Object.values(coverage).some((value) => !integer(value)))
		throw new Error('[BALANCED_HTTP_APP_PLAN] invalid coverage counter')
	const validatorSlots =
		appPlan.httpRoutes.reduce(
			(total, route) => total + route.validators.length,
			0
		) +
		appPlan.wsRoutes.reduce(
			(total, route) => total + route.validators.length,
			0
		)
	if (
		coverage.plannedHttpRoutes !== coverage.winningHttpRoutes ||
		appPlan.httpRoutes.length !== coverage.winningHttpRoutes
	)
		throw new Error(
			`[BALANCED_HTTP_COVERAGE] planned ${coverage.plannedHttpRoutes}/${coverage.winningHttpRoutes} winning routes`
		)
	if (
		coverage.declaredHttpRoutes - coverage.shadowedHttpRoutes !==
			coverage.winningHttpRoutes ||
		appPlan.wsRoutes.length !== coverage.winningWSRoutes ||
		coverage.declaredWSRoutes - coverage.shadowedWSRoutes !==
			coverage.winningWSRoutes ||
		coverage.validatorSlots !== validatorSlots ||
		coverage.externalBindings !== bindingLayout.length ||
		bindingLayout.length !== externalBindings.length
	)
		throw new Error('[BALANCED_HTTP_APP_PLAN] inconsistent coverage or sidecar')

	const ordinal = new Map<string, number>()
	for (let index = 0; index < bindingLayout.length; index++) {
		const binding = bindingLayout[index]!
		if (
			!integer(binding.nodeId) ||
			!bindingRoles.has(binding.role) ||
			!integer(binding.ordinal)
		)
			throw new Error('[BALANCED_HTTP_BINDING] invalid layout descriptor')
		const key = `${binding.nodeId}\0${binding.role}`
		const expected = ordinal.get(key) ?? 0
		if (binding.ordinal !== expected)
			throw new Error('[BALANCED_HTTP_BINDING] invalid layout ordinal')
		ordinal.set(key, expected + 1)
	}

	const claimed = new Uint8Array(bindingLayout.length)
	const claim = (indices: readonly number[], nodeId: number, label: string) => {
		for (const index of indices) {
			if (
				!integer(index) ||
				index >= bindingLayout.length ||
				claimed[index] ||
				bindingLayout[index]!.nodeId !== nodeId
			)
				throw new Error(`[BALANCED_HTTP_BINDING] invalid ${label} index`)
			claimed[index] = 1
		}
	}

	if (appPlan.application.nodeId !== 0)
		throw new Error('[BALANCED_HTTP_APP_PLAN] invalid application node')
	claim(appPlan.application.bindingIndices, 0, 'application')
	for (
		let routeIndex = 0;
		routeIndex < appPlan.httpRoutes.length;
		routeIndex++
	) {
		const route = appPlan.httpRoutes[routeIndex]!
		if (
			route.id !== routeIndex ||
			route.nodeId !== routeIndex + 1 ||
			!handlerForms.has(route.handlerForm)
		)
			throw new Error('[BALANCED_HTTP_APP_PLAN] invalid HTTP route identity')
		claim(route.bindingIndices, route.nodeId, 'route')
		claim(route.program.bindingIndices, route.nodeId, 'program')
		for (const validator of route.validators)
			claim(validator.bindingIndices, route.nodeId, 'validator')
		const phases = new Set<LifecyclePhase>()
		for (const reference of route.lifecycle) {
			const segment = appPlan.lifecycleSegments[reference.segmentId]
			if (
				Object.keys(reference).sort().join('\0') !==
					'end\0phase\0segmentId\0start' ||
				phases.has(reference.phase) ||
				!segment ||
				reference.start !== 0 ||
				reference.end !== segment.length ||
				lifecycleRolePhase(segment.role) !== reference.phase
			)
				throw new Error('[BALANCED_HTTP_BINDING] invalid lifecycle reference')
			phases.add(reference.phase)
		}
	}
	for (let id = 0; id < appPlan.lifecycleSegments.length; id++) {
		const segment = appPlan.lifecycleSegments[id]!
		const nodeId =
			appPlan.httpRoutes.length + appPlan.wsRoutes.length + id + 1
		if (
			Object.keys(segment).sort().join('\0') !==
				'bindingIndex\0id\0length\0name\0parent\0role' ||
			segment.id !== id ||
			(segment.parent !== null &&
				(!integer(segment.parent) || segment.parent >= id)) ||
			segment.length !==
				(segment.parent === null
					? 1
					: appPlan.lifecycleSegments[segment.parent]!.length + 1) ||
			!lifecycleBindingRoles.has(segment.role) ||
			typeof segment.name !== 'string' ||
			segment.name.length === 0 ||
			(segment.parent !== null &&
				lifecycleRolePhase(appPlan.lifecycleSegments[segment.parent]!.role) !==
					lifecycleRolePhase(segment.role))
		)
			throw new Error('[BALANCED_HTTP_BINDING] invalid lifecycle segment')
		claim([segment.bindingIndex], nodeId, 'lifecycle segment')
	}
	for (let wsIndex = 0; wsIndex < appPlan.wsRoutes.length; wsIndex++) {
		const route = appPlan.wsRoutes[wsIndex]!
		claim(
			route.identity.bindingIndices,
			appPlan.httpRoutes.length + wsIndex + 1,
			'WebSocket'
		)
		for (const validator of route.validators)
			claim(
				validator.bindingIndices,
				appPlan.httpRoutes.length + wsIndex + 1,
				'WebSocket validator'
			)
	}
	if (claimed.some((value) => value !== 1))
		throw new Error('[BALANCED_HTTP_BINDING] unclaimed layout index')
}

function lowerLifecycleSegments(appPlan: AppPlan) {
	const sequences: BalancedLifecycleSequenceImage[] = []
	for (const segment of appPlan.lifecycleSegments) {
		const descriptor = appPlan.bindingLayout[segment.bindingIndex]
		const value = appPlan.externalBindings[segment.bindingIndex]
		if (
			!descriptor ||
			descriptor.role !== segment.role ||
			typeof value !== 'function'
		)
			throw new Error('[BALANCED_HTTP_BINDING] invalid lifecycle binding')
		sequences.push(
			appendLifecycleSequence(
				segment.parent === null
					? EMPTY_LIFECYCLE_SEQUENCE
					: sequences[segment.parent]!,
				Object.freeze({
					role: segment.role,
					name: bindingName(value),
					value: value as AnyFn
				})
			)
		)
	}
	return Object.freeze(sequences)
}

const phaseSequence = (
	route: HttpRoutePlan,
	phase: LifecyclePhase,
	sequences: readonly BalancedLifecycleSequenceImage[]
) => {
	let reference: LifecycleSegmentReference | undefined
	for (const candidate of route.lifecycle)
		if (candidate.phase === phase) {
			if (reference) throw new Error('[BALANCED_HTTP_BINDING] duplicate lifecycle phase')
			reference = candidate
		}
	if (!reference) return EMPTY_LIFECYCLE_SEQUENCE
	const sequence = sequences[reference.segmentId]
	if (
		!sequence ||
		reference.start !== 0 ||
		reference.end !== sequence.length
	)
		throw new Error('[BALANCED_HTTP_BINDING] invalid lifecycle reference')
	return sequence
}

function lowerBalancedHttpRouteFromValidatedAppPlan(
	appPlan: AppPlan,
	route: HttpRoutePlan,
	adapter: ElysiaAdapter,
	lifecycleSegments: readonly BalancedLifecycleSequenceImage[]
): BalancedHttpRuntimePlan {
	if (route.program.version !== BALANCED_HTTP_PROGRAM_VERSION)
		throw new Error(
			`[BALANCED_HTTP_PROGRAM] unsupported version ${route.program.version}`
		)
	const program: unknown = route.program.content
	assertBalancedHttpProgram(program)
	const seen = new Set<number>()
	const ordinals = new Map<ExternalBindingRole, number>()
	const read = (index: number, role: ExternalBindingRole) => {
		const descriptor = appPlan.bindingLayout[index]
		const ordinal = ordinals.get(role) ?? 0
		if (
			!integer(index) ||
			index >= appPlan.externalBindings.length ||
			seen.has(index) ||
			!descriptor ||
			descriptor.nodeId !== route.nodeId ||
			descriptor.role !== role ||
			descriptor.ordinal !== ordinal
		)
			throw new Error(
				`[BALANCED_HTTP_BINDING] ${route.method} ${route.path} expected ${role}:${ordinal}`
			)
		seen.add(index)
		ordinals.set(role, ordinal + 1)
		return appPlan.externalBindings[index]
	}
	if (route.program.bindingIndices.length !== 1)
		throw new Error('[BALANCED_HTTP_BINDING] expected one handler')
	const handler = read(
		route.program.bindingIndices[0]!,
		handlerRole(route.handlerForm)
	)
	if (
		((route.handlerForm === 'function' || route.handlerForm === 'mount') &&
			typeof handler !== 'function') ||
		(route.handlerForm === 'response' && !(handler instanceof Response)) ||
		(route.handlerForm === 'promise' && !isThenable(handler))
	)
		throw new Error('[BALANCED_HTTP_BINDING] invalid handler value')

	let cursor = 0
	const routeValue = (role: ExternalBindingRole) => {
		const index = route.bindingIndices[cursor++]
		if (index === undefined)
			throw new Error(`[BALANCED_HTTP_BINDING] missing ${role}`)
		return read(index, role)
	}
	const routeCallable = (role: ExternalBindingRole) => {
		const value = routeValue(role)
		if (typeof value !== 'function')
			throw new Error(`[BALANCED_HTTP_BINDING] ${role} must be callable`)
		return value as AnyFn
	}
	const bodyParserHooks = program.body.parsers.map((parser) =>
		parser === null ? routeCallable('parser') : parser
	)
	const body = bodyParserHooks.some((parser) => typeof parser === 'function')
		? Object.freeze({
				...program.body,
				parserNames: bodyParserHooks.map((parser) =>
					typeof parser === 'function' ? bindingName(parser) : parser
				)
			})
		: program.body
	const trace = program.trace
		? Object.freeze({
				...program.trace,
				handlerName: bindingName(handler)
			})
		: null
	const runtimeProgram =
		body === program.body && trace === program.trace
			? program
			: Object.freeze({ ...program, body, trace })
	const transforms = phaseSequence(route, 'transform', lifecycleSegments)
	const before = phaseSequence(route, 'beforeHandle', lifecycleSegments)
	const after = phaseSequence(route, 'afterHandle', lifecycleSegments)
	const map = phaseSequence(route, 'mapResponse', lifecycleSegments)
	const afterResponse = phaseSequence(route, 'afterResponse', lifecycleSegments)
	const error = phaseSequence(route, 'error', lifecycleSegments)
	if (
		transforms.length !== program.hooks.transforms ||
		before.length !== program.hooks.beforePrefix + program.hooks.before ||
		after.length !== program.hooks.after ||
		map.length !== program.hooks.map ||
		afterResponse.length !== program.hooks.afterResponse ||
		error.length !== program.hooks.error
	)
		throw new Error('[BALANCED_HTTP_BINDING] lifecycle length mismatch')
	let beforeIndex = 0
	for (const entry of before)
		if (
			beforeIndex++ < program.hooks.beforePrefix &&
			entry.role !== 'beforeHandle'
		)
			throw new Error('[BALANCED_HTTP_BINDING] invalid beforeHandle prefix')
	const tracers: AnyFn[] = []
	if (program.trace)
		for (let i = 0; i < program.trace.count; i++) {
			const index = route.bindingIndices[cursor++]
			if (index === undefined)
				throw new Error('[BALANCED_HTTP_BINDING] missing tracer')
			const tracer = read(index, 'tracer')
			if (typeof tracer !== 'function')
				throw new Error('[BALANCED_HTTP_BINDING] tracer must be callable')
			tracers.push(tracer as AnyFn)
		}
	let queryPlan: unknown
	let cookieConfig: CompiledCookieConfig | undefined
	if (program.cookie) {
		const validSecrets = (value: unknown) =>
			value === null ||
			typeof value === 'string' ||
			(Array.isArray(value) &&
				value.every((secret) => secret === null || typeof secret === 'string'))
		const takeSecrets = () => {
			const value = routeValue('cookieCryptoProvider')
			if (!validSecrets(value))
				throw new Error('[BALANCED_HTTP_BINDING] invalid cookie secrets')
			return value as CompiledCookieConfig['globalSecrets']
		}
		const globalSecrets = program.cookie.hasGlobalSecrets
			? takeSecrets()
			: undefined
		const fields: CompiledCookieConfig['fields'] = Object.create(null)
		for (const field of program.cookie.fields)
			fields[field.name] = Object.freeze({
				sign: field.sign,
				defaults: field.defaults.length
					? decodeCookieDefaults(field.defaults)
					: undefined,
				secrets: field.hasSecrets ? takeSecrets() : undefined
			})
		const globalSign =
			program.cookie.globalSign === null
				? undefined
				: program.cookie.globalSign === true
					? true
					: [...program.cookie.globalSign]
		cookieConfig = Object.freeze({
			defaults: decodeCookieDefaults(program.cookie.defaults),
			fields: Object.freeze(fields),
			globalSign,
			globalSignSet: Array.isArray(globalSign)
				? new Set(globalSign)
				: undefined,
			globalSecrets,
			hasSign: program.cookie.hasSign,
			verify: program.cookie.verify
		})
	}
	if (cursor !== route.bindingIndices.length)
		throw new Error('[BALANCED_HTTP_BINDING] unexpected route binding')
	const finalizerIndices = appPlan.application.bindingIndices.filter(
		(index) => appPlan.bindingLayout[index]?.role === 'routeErrorFinalizer'
	)
	if (finalizerIndices.length > 1)
		throw new Error('[BALANCED_HTTP_BINDING] multiple application finalizers')
	const finalizeError = finalizerIndices.length
		? appPlan.externalBindings[finalizerIndices[0]!]
		: undefined
	if (finalizeError !== undefined && typeof finalizeError !== 'function')
		throw new Error('[BALANCED_HTTP_BINDING] invalid application finalizer')

	const validators: Record<string, any> = Object.create(null)
	const response: Record<number, any> = Object.create(null)
	const maybeValidatorSlots: string[] = []
	const slots = route.validators.map((validator) => validator.slot)
	if (
		slots.length !== program.validators.length ||
		slots.some(
			(slot, index) =>
				slot !== program.validators[index] ||
				!canonicalValidatorSlot(slot) ||
				(index > 0 && slots[index - 1]! >= slot)
		)
	)
		throw new Error('[BALANCED_HTTP_BINDING] validator slot mismatch')
	for (const validator of route.validators) {
		if (validator.version !== VALIDATOR_SEMANTICS_VERSION)
			throw new Error('[BALANCED_HTTP_BINDING] invalid validator version')
		if (validator.bindingIndices.length !== 1)
			throw new Error('[BALANCED_HTTP_BINDING] invalid validator binding')
		const binding = read(
			validator.bindingIndices[0]!,
			expectedRole(validator.slot)
		) as ValidatorExecutorBinding
		if (
			!binding ||
			typeof binding !== 'object' ||
			Array.isArray(binding) ||
			!Object.isFrozen(binding) ||
			Object.keys(binding).sort().join('\0') !== 'queryPlan\0validator' ||
			!binding.validator ||
			typeof binding.validator !== 'object' ||
			!Object.isFrozen(binding.validator)
		)
			throw new Error('[BALANCED_HTTP_BINDING] invalid validator executor')
		let expected: ValidatorSlotInput
		try {
			expected = createValidatorSlotInput(
				validator.slot,
				validatorSemantics(binding.validator),
				binding
			)
		} catch (error) {
			throw new Error(
				`[BALANCED_HTTP_BINDING] invalid ${validator.slot} validator executor: ${
					error instanceof Error ? error.message : String(error)
				}`
			)
		}
		if (JSON.stringify(expected.content) !== JSON.stringify(validator.artifact))
			throw new Error('[BALANCED_HTTP_BINDING] validator artifact mismatch')
		if (validatorArtifactSettlement(validator.artifact) === 'maybe')
			maybeValidatorSlots.push(validator.slot)
		const value = binding.validator as any
		if (validator.slot.startsWith('response:'))
			if (
				typeof value.EncodeFrom !== 'function' ||
				(maybeValidatorSlots.includes(validator.slot) &&
					value.mayReturnPromise &&
					typeof value.From !== 'function')
			)
				throw new Error(
					'[BALANCED_HTTP_BINDING] response validator must encode'
				)
			else response[Number(validator.slot.slice(9))] = value
		else {
			if (typeof value.From !== 'function')
				throw new Error('[BALANCED_HTTP_BINDING] validator must decode')
			validators[validator.slot] = value
		}
		if (validator.slot === 'query') queryPlan = binding.queryPlan
	}
	if (Object.keys(response).length) validators.response = response
	if (queryPlan) validators.queryPlan = queryPlan

	let defaultResponseState: DefaultResponseState | undefined
	if (program.defaultHeaders) {
		const headers: Record<string, string> = Object.create(null)
		for (const [key, value] of program.defaultHeaders) headers[key] = value
		Object.defineProperty(headers, defaultHeaders, { value: headers })
		Object.freeze(headers)
		defaultResponseState = Object.freeze({ headers })
	}

	return Object.freeze({
		version: BALANCED_HTTP_PROGRAM_VERSION,
		path: route.path,
		handlerForm: route.handlerForm,
		handler,
		adapter,
		program: runtimeProgram,
		bodyParserHooks: bodyParserHooks.length
			? Object.freeze(bodyParserHooks)
			: undefined,
		validators: Object.keys(validators).length
			? (validators as RouteValidator<any>)
			: undefined,
		cookieConfig,
		hooks:
			transforms.length ||
			before.length ||
			after.length ||
			map.length ||
			afterResponse.length ||
			error.length
				? Object.freeze({
						transforms,
						before,
						after,
						map,
						afterResponse,
						error
					})
				: EMPTY_HTTP_HOOKS,
		finalizeError: finalizeError as RouteErrorFinalizer | undefined,
		defaultResponseState,
		maybeValidatorSlots: maybeValidatorSlots.length
			? Object.freeze(maybeValidatorSlots)
			: EMPTY_RUNTIME_VALUES,
		tracers: tracers.length ? Object.freeze(tracers) : EMPTY_RUNTIME_VALUES
	})
}

export function lowerBalancedHttpRoute(
	appPlan: AppPlan,
	route: HttpRoutePlan,
	ambientAdapter?: ElysiaAdapter
): BalancedHttpRuntimePlan {
	assertBalancedHttpBindingImage(appPlan)
	if (appPlan.httpRoutes[route.id] !== route)
		throw new Error('[BALANCED_HTTP_APP_PLAN] route is not owned by AppPlan')
	const adapter = lowerBalancedAdapter(appPlan, ambientAdapter)
	return lowerBalancedHttpRouteFromValidatedAppPlan(
		appPlan,
		route,
		adapter,
		lowerLifecycleSegments(appPlan)
	)
}

export function lowerBalancedHttpAppPlan(
	appPlan: AppPlan,
	ambientAdapter?: ElysiaAdapter
): readonly BalancedHttpRuntimePlan[] {
	assertBalancedHttpBindingImage(appPlan)
	const adapter = lowerBalancedAdapter(appPlan, ambientAdapter)
	const lifecycleSegments = lowerLifecycleSegments(appPlan)

	return Object.freeze(
		appPlan.httpRoutes.map((route) =>
			lowerBalancedHttpRouteFromValidatedAppPlan(
				appPlan,
				route,
				adapter,
				lifecycleSegments
			)
		)
	)
}
