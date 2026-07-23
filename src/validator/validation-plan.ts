import type { TSchema } from 'typebox'
import type { TLocalizedValidationError } from 'typebox/error'
import { Guard } from 'typebox/guard'
import { Settings } from 'typebox/system'
import { Errors as TypeBoxErrors } from 'typebox/value'
import createMirror from 'exact-mirror'

import { ValidationError } from '../error'
import {
	ELYSIA_BUILTIN,
	ELYSIA_TYPES,
	VALIDATION_PLAN_BUILTIN,
	VALIDATION_PLAN_FUSED_QUERY,
	VALIDATION_PLAN_ORACLE,
	VALIDATION_PLAN_QUERY
} from '../type/constants'
import { Compile, Decode } from '../type/bridge'
import { schemaHasDangerousProperties } from '../type/validator/clean-safe'
import { Validator, type ValidatorOptions } from '.'
import { ValidationPlanMultiValidator } from './validation-plan-composition'
import {
	createCompactErrorLocator,
	compactDiagnosticSchema,
	compactErrors,
	type CompactErrorLocator
} from './compact-errors'
import {
	attachValidatorSemanticSource,
	readValidatorSemanticSource
} from './semantic-channel'
import {
	validationPlanSemantics,
	validatorSemanticsWithDiagnostics,
	type TypeBoxExecutionPolicy
} from '../compile/validator-semantics'

export type ValidationPlanDomain = 'json' | 'string' | 'encode'

const proxyDetector = (globalThis as any).process?.getBuiltinModule?.(
	'node:util'
)?.types?.isProxy as ((value: unknown) => boolean) | undefined
const isProxy = proxyDetector?.(new Proxy({}, {})) ? proxyDetector : undefined

type Coerce = 0 | 1 | 2 | 3

interface BaseNode {
	pc: number
	optional: boolean
	hasDefault: boolean
	defaultValue?: unknown
}

interface ObjectNode extends BaseNode {
	kind: 1
	keys: string[]
	known: Set<string>
	properties: PlanNode[]
	required: Set<string>
	additional: 0 | 2
	min?: number
	max?: number
	string: boolean
}

interface ArrayNode extends BaseNode {
	kind: 2
	items: PlanNode
	min?: number
	max?: number
	string: boolean
}

interface StringNode extends BaseNode {
	kind: 3
	min?: number
	max?: number
	pattern?: RegExp
}

interface NumberNode extends BaseNode {
	kind: 4
	integer: boolean
	coerce: Coerce
	explicit: boolean
	minimum?: number
	maximum?: number
	exclusiveMinimum?: number
	exclusiveMaximum?: number
	multipleOf?: number
}

interface BooleanNode extends BaseNode {
	kind: 5
	coerce: Coerce
	explicit: boolean
}

interface NullNode extends BaseNode {
	kind: 6
}

interface LiteralNode extends BaseNode {
	kind: 7
	value: string | number | boolean | null
}

type PlanNode =
	| ObjectNode
	| ArrayNode
	| StringNode
	| NumberNode
	| BooleanNode
	| NullNode
	| LiteralNode

export interface ValidationPlan {
	encode?: true
	root: PlanNode
	coerced: boolean
	hasDefault: boolean
}

export interface ValidationScratch {
	pc: number
	path: (string | number)[]
	failurePath: string
}

export const VALIDATION_FAILED = Symbol('elysia.validation.failed')

const metadata = new Set([
	'~kind',
	'~elyTyp',
	'~optional',
	'$id',
	'title',
	'description',
	'default',
	'examples',
	'deprecated',
	'readOnly',
	'writeOnly'
])

const allowed = {
	Object: new Set([
		'type',
		'properties',
		'required',
		'additionalProperties',
		'minProperties',
		'maxProperties'
	]),
	Array: new Set(['type', 'items', 'minItems', 'maxItems']),
	String: new Set(['type', 'minLength', 'maxLength', 'pattern']),
	Number: new Set([
		'type',
		'minimum',
		'maximum',
		'exclusiveMinimum',
		'exclusiveMaximum',
		'multipleOf'
	]),
	Integer: new Set([
		'type',
		'minimum',
		'maximum',
		'exclusiveMinimum',
		'exclusiveMaximum',
		'multipleOf'
	]),
	Boolean: new Set(['type']),
	Null: new Set(['type']),
	Literal: new Set(['type', 'const'])
} as const

const own = (value: object, key: PropertyKey) =>
	Object.prototype.hasOwnProperty.call(value, key)

const ACCESSOR = Symbol('elysia.validation.accessor')

const dataProperty = (value: object, key: PropertyKey) => {
	for (
		let current: object | null = value;
		current && current !== Object.prototype;
		current = Object.getPrototypeOf(current)
	) {
		const descriptor = Object.getOwnPropertyDescriptor(current, key)
		if (descriptor)
			return 'value' in descriptor ? descriptor.value : ACCESSOR
	}
}

const exactDataKeys = (value: object, keys: string[]) => {
	const actual = Reflect.ownKeys(value)
	if (
		actual.length !== keys.length ||
		actual.some((key) => typeof key !== 'string' || !keys.includes(key))
	)
		return false

	return actual.every(
		(key) => 'value' in Object.getOwnPropertyDescriptor(value, key)!
	)
}

const keysAreAllowed = (
	schema: Record<PropertyKey, unknown>,
	kind: keyof typeof allowed
) => {
	for (const key of Reflect.ownKeys(schema)) {
		if (typeof key !== 'string') return false
		if (!('value' in Object.getOwnPropertyDescriptor(schema, key)!))
			return false
		if (!metadata.has(key) && !allowed[kind].has(key as never)) return false
	}

	return true
}

const hasCanonicalPrototype = (schema: object, kind: string) => {
	const prototype = Object.getPrototypeOf(schema)
	if (prototype === null || prototype === Object.prototype) return true
	if (Object.getPrototypeOf(prototype) !== Object.prototype) return false
	return (
		exactDataKeys(prototype, ['~kind']) &&
		Object.getOwnPropertyDescriptor(prototype, '~kind')!.value === kind
	)
}

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value)

const validBound = (value: unknown) =>
	value === undefined || isFiniteNumber(value)

const validCount = (value: unknown) =>
	value === undefined || (Number.isInteger(value) && (value as number) >= 0)

const cloneDefault = (value: unknown) =>
	value !== null && typeof value === 'object' ? structuredClone(value) : value

function isJsonDefault(value: unknown, seen = new Set<object>()): boolean {
	if (
		value === null ||
		typeof value === 'string' ||
		typeof value === 'boolean'
	)
		return true
	if (typeof value === 'number') return Number.isFinite(value)
	if (!value || typeof value !== 'object' || seen.has(value)) return false
	if (
		Object.getPrototypeOf(value) !== Object.prototype &&
		!Array.isArray(value)
	)
		return false

	seen.add(value)
	for (const key of Reflect.ownKeys(value)) {
		if (Array.isArray(value) && key === 'length') continue
		if (typeof key !== 'string') return false
		const descriptor = Object.getOwnPropertyDescriptor(value, key)!
		if (
			!('value' in descriptor) ||
			!descriptor.enumerable ||
			!isJsonDefault(descriptor.value, seen)
		)
			return false
	}
	seen.delete(value)

	return true
}

interface BuildContext {
	domain: ValidationPlanDomain
	depth: number
	stringScalar: boolean
	state: {
		nextPc: number
		coerced: boolean
		hasDefault: boolean
		hasOptional: boolean
	}
}

function elysiaNode(schema: any) {
	const ely = dataProperty(schema, '~elyTyp')
	if (ely === ACCESSOR) return false
	if (
		ely !== ELYSIA_TYPES.Numeric &&
		ely !== ELYSIA_TYPES.Integer &&
		ely !== ELYSIA_TYPES.BooleanString &&
		ely !== ELYSIA_TYPES.ObjectString &&
		ely !== ELYSIA_TYPES.ArrayString
	)
		return ely === undefined ? undefined : false

	const brandDescriptor = Object.getOwnPropertyDescriptor(
		schema,
		ELYSIA_BUILTIN
	)
	if (!brandDescriptor || !('value' in brandDescriptor)) return false
	const brand = brandDescriptor.value

	for (const key of Reflect.ownKeys(schema)) {
		if (key === ELYSIA_BUILTIN) continue
		if (typeof key !== 'string') return false
		if (!('value' in Object.getOwnPropertyDescriptor(schema, key)!))
			return false
		if (
			key !== 'anyOf' &&
			key !== '~kind' &&
			key !== '~elyTyp' &&
			!metadata.has(key)
		)
			return false
	}

	if (
		dataProperty(schema, '~kind') !== 'Union' ||
		!Array.isArray(schema.anyOf) ||
		schema.anyOf.length !== 2
	)
		return false

	const first = schema.anyOf[0]
	const second = schema.anyOf[1]
	const firstRefine = first?.['~refine']
	const secondRefine = second?.['~refine']
	const codec = second?.['~codec']
	if (
		brand?.type !== ely ||
		brand.firstCheck !== firstRefine?.[0]?.check ||
		brand.firstError !== firstRefine?.[0]?.error ||
		brand.check !== secondRefine?.[0]?.check ||
		brand.error !== secondRefine?.[0]?.error ||
		brand.decode !== codec?.decode ||
		brand.encode !== codec?.encode
	)
		return false

	const expected =
		ely === ELYSIA_TYPES.Numeric
			? 'Number'
			: ely === ELYSIA_TYPES.Integer
				? undefined
				: ely === ELYSIA_TYPES.BooleanString
					? 'Boolean'
					: ely === ELYSIA_TYPES.ObjectString
						? 'Object'
						: 'Array'
	if (
		(expected === undefined
			? dataProperty(first, '~kind') !== 'Number' &&
				dataProperty(first, '~kind') !== 'Integer'
			: dataProperty(first, '~kind') !== expected) ||
		dataProperty(second, '~kind') !== 'String' ||
		!exactDataKeys(second, ['type', '~kind', '~refine', '~codec']) ||
		!Array.isArray(secondRefine) ||
		secondRefine.length !== 1 ||
		!exactDataKeys(secondRefine[0], ['check', 'error']) ||
		!exactDataKeys(codec, ['decode', 'encode']) ||
		typeof secondRefine[0]?.check !== 'function' ||
		typeof secondRefine[0]?.error !== 'function' ||
		typeof codec?.decode !== 'function' ||
		typeof codec?.encode !== 'function'
	)
		return false

	if (
		ely === ELYSIA_TYPES.Integer &&
		dataProperty(first, '~kind') === 'Number' &&
		(!Array.isArray(firstRefine) ||
			firstRefine.length !== 1 ||
			typeof firstRefine[0]?.check !== 'function' ||
			typeof firstRefine[0]?.error !== 'function')
	)
		return false

	if (
		ely === ELYSIA_TYPES.Integer &&
		dataProperty(first, '~kind') === 'Number'
	) {
		const { ['~refine']: _, ...integerSchema } = first
		integerSchema['~kind'] = 'Integer'
		return { ely, schema: integerSchema }
	}

	return { ely, schema: first }
}

function buildNode(schema: any, context: BuildContext): PlanNode | undefined {
	if (!schema || typeof schema !== 'object') return

	const wrapper = elysiaNode(schema)
	if (wrapper === false) return
	// Response codecs keep the legacy encode mirror until callback execution is
	// represented explicitly in the plan.
	if (context.domain === 'encode' && wrapper) return

	const raw = schema
	let explicit: number | undefined
	if (wrapper) {
		explicit = wrapper.ely
		schema = wrapper.schema
		context.state.coerced = true
	}

	const kind = dataProperty(schema, '~kind') as
		| keyof typeof allowed
		| typeof ACCESSOR
		| undefined
	if (kind === ACCESSOR || !kind || !(kind in allowed)) return
	if (!hasCanonicalPrototype(schema, kind) || !keysAreAllowed(schema, kind))
		return

	const base: BaseNode = {
		pc: context.state.nextPc++,
		optional: raw['~optional'] === true || schema['~optional'] === true,
		hasDefault: own(raw, 'default') || own(schema, 'default')
	}
	if (base.optional) context.state.hasOptional = true
	if (base.hasDefault)
		base.defaultValue = own(raw, 'default') ? raw.default : schema.default
	if (context.domain === 'encode' && base.hasDefault) return
	if (base.hasDefault && !isJsonDefault(base.defaultValue)) return
	if (base.hasDefault) {
		try {
			base.defaultValue = cloneDefault(base.defaultValue)
		} catch {
			return
		}
		context.state.hasDefault = true
	}

	switch (kind) {
		case 'Object': {
			if (
				schema.type !== 'object' ||
				!schema.properties ||
				typeof schema.properties !== 'object' ||
				!validCount(schema.minProperties) ||
				!validCount(schema.maxProperties) ||
				(schema.additionalProperties !== undefined &&
					schema.additionalProperties !== false)
			)
				return
			// The exact mirror preserves source key order when additions are kept.
			if (schema.additionalProperties === true) return

			const keys = Object.keys(schema.properties)

			const required = new Set<string>()
			if (schema.required !== undefined) {
				if (!Array.isArray(schema.required)) return
				for (const key of schema.required) {
					if (typeof key !== 'string' || !keys.includes(key)) return
					required.add(key)
				}
			}

			const properties: PlanNode[] = []
			const structuralString =
				explicit === ELYSIA_TYPES.ObjectString ||
				(context.domain === 'string' && context.depth === 1)
			if (structuralString) context.state.coerced = true

			for (const key of keys) {
				const descriptor = Object.getOwnPropertyDescriptor(
					schema.properties,
					key
				)
				if (!descriptor || !('value' in descriptor)) return
				const child = buildNode(descriptor.value, {
					...context,
					depth: context.depth + 1,
					stringScalar: false
				})
				if (!child) return
				properties.push(child)
			}

			return {
				...base,
				kind: 1,
				keys,
				known: new Set(keys),
				properties,
				required,
				additional: schema.additionalProperties === false ? 2 : 0,
				min: schema.minProperties,
				max: schema.maxProperties,
				string: structuralString
			}
		}
		case 'Array': {
			if (context.domain === 'encode') return
			if (
				schema.type !== 'array' ||
				!schema.items ||
				Array.isArray(schema.items) ||
				!validCount(schema.minItems) ||
				!validCount(schema.maxItems)
			)
				return

			const structuralString =
				explicit === ELYSIA_TYPES.ArrayString ||
				(context.domain === 'string' && context.depth === 1)
			if (structuralString) context.state.coerced = true
			const items = buildNode(schema.items, {
				...context,
				depth: context.depth + 1,
				stringScalar: context.stringScalar || structuralString
			})
			if (!items) return

			return {
				...base,
				kind: 2,
				items,
				min: schema.minItems,
				max: schema.maxItems,
				string: structuralString
			}
		}
		case 'String': {
			if (
				schema.type !== 'string' ||
				!validCount(schema.minLength) ||
				!validCount(schema.maxLength) ||
				(schema.pattern !== undefined &&
					typeof schema.pattern !== 'string')
			)
				return

			let pattern: RegExp | undefined
			if (schema.pattern !== undefined)
				try {
					pattern = new RegExp(schema.pattern, 'u')
				} catch {
					return
				}

			return {
				...base,
				kind: 3,
				min: schema.minLength,
				max: schema.maxLength,
				pattern
			}
		}
		case 'Number':
		case 'Integer': {
			if (
				(schema.type !== 'number' && schema.type !== 'integer') ||
				!validBound(schema.minimum) ||
				!validBound(schema.maximum) ||
				!validBound(schema.exclusiveMinimum) ||
				!validBound(schema.exclusiveMaximum) ||
				(schema.multipleOf !== undefined &&
					(!isFiniteNumber(schema.multipleOf) ||
						schema.multipleOf <= 0))
			)
				return

			let coerce: Coerce = 0
			if (explicit === ELYSIA_TYPES.Numeric) coerce = 1
			else if (explicit === ELYSIA_TYPES.Integer) coerce = 2
			else if (
				context.stringScalar ||
				(context.domain === 'string' && context.depth === 1)
			)
				coerce = kind === 'Integer' ? 2 : 1
			else if (
				context.domain === 'json' &&
				(kind === 'Integer' || context.depth === 0)
			)
				coerce = kind === 'Integer' ? 2 : 1
			if (coerce) context.state.coerced = true

			return {
				...base,
				kind: 4,
				integer:
					kind === 'Integer' || explicit === ELYSIA_TYPES.Integer,
				coerce,
				explicit:
					explicit === ELYSIA_TYPES.Numeric ||
					explicit === ELYSIA_TYPES.Integer,
				minimum: schema.minimum,
				maximum: schema.maximum,
				exclusiveMinimum: schema.exclusiveMinimum,
				exclusiveMaximum: schema.exclusiveMaximum,
				multipleOf: schema.multipleOf
			}
		}
		case 'Boolean': {
			if (schema.type !== 'boolean') return
			const coerce =
				explicit === ELYSIA_TYPES.BooleanString ||
				context.stringScalar ||
				(context.domain === 'string' && context.depth === 1) ||
				(context.domain === 'json' && context.depth === 0)
					? 3
					: 0
			if (coerce) context.state.coerced = true
			return {
				...base,
				kind: 5,
				coerce,
				explicit: explicit === ELYSIA_TYPES.BooleanString
			}
		}
		case 'Null':
			return schema.type === 'null' ? { ...base, kind: 6 } : undefined
		case 'Literal':
			return (schema.const === null && schema.type === 'null') ||
				(typeof schema.const === 'string' &&
					schema.type === 'string') ||
				(isFiniteNumber(schema.const) && schema.type === 'number') ||
				(typeof schema.const === 'boolean' && schema.type === 'boolean')
				? { ...base, kind: 7, value: schema.const }
				: undefined
	}
}

export function createValidationPlan(
	schema: TSchema,
	domain: ValidationPlanDomain
): ValidationPlan | undefined {
	const context: BuildContext = {
		domain,
		depth: 0,
		stringScalar: false,
		state: {
			nextPc: 0,
			coerced: false,
			hasDefault: false,
			hasOptional: false
		}
	}
	let root: PlanNode | undefined
	try {
		root = buildNode(schema, context)
	} catch {
		return
	}
	if (
		root?.optional ||
		(domain === 'string' && root?.kind === 2) ||
		(context.state.hasOptional && Settings.Get().exactOptionalPropertyTypes)
	)
		return
	if (!root) return

	const plan: ValidationPlan = {
		root,
		coerced: context.state.coerced,
		hasDefault: context.state.hasDefault
	}
	if (domain === 'encode') plan.encode = true
	return plan
}

const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/
const integer = /^[+-]?\d+$/
const CHECK_ONLY = 1
const SUPPRESS_IMPLICIT_COERCE = 2

function fail(node: PlanNode, scratch: ValidationScratch) {
	if (scratch.pc === -1) {
		scratch.pc = node.pc
		scratch.failurePath = scratch.path.length
			? '/' +
				scratch.path
					.map((part) =>
						String(part).replace(/~/g, '~0').replace(/\//g, '~1')
					)
					.join('/')
			: ''
	}

	return VALIDATION_FAILED
}

function writeOwn(
	target: Record<string, unknown>,
	key: string,
	value: unknown
) {
	if (key !== '__proto__') {
		target[key] = value
		return
	}

	Object.defineProperty(target, key, {
		value,
		enumerable: true,
		configurable: true,
		writable: true
	})
}

function executeStructureString(
	node: ObjectNode | ArrayNode,
	input: string,
	scratch: ValidationScratch,
	opening: number
) {
	if (input.charCodeAt(0) !== opening) return fail(node, scratch)

	let parsed: unknown
	try {
		parsed = JSON.parse(input)
	} catch {
		return fail(node, scratch)
	}

	if (
		executeValidationPlan(
			node,
			parsed,
			scratch,
			CHECK_ONLY | SUPPRESS_IMPLICIT_COERCE
		) === VALIDATION_FAILED
	)
		return VALIDATION_FAILED

	return executeValidationPlan(
		node,
		parsed,
		scratch,
		SUPPRESS_IMPLICIT_COERCE
	)
}

export function executeValidationPlan(
	node: PlanNode,
	input: unknown,
	scratch: ValidationScratch,
	mode = 0
): unknown | typeof VALIDATION_FAILED {
	let value = input
	if (value === undefined && node.hasDefault && !(mode & CHECK_ONLY))
		value = cloneDefault(node.defaultValue)

	if (value === undefined && node.optional) return undefined

	switch (node.kind) {
		case 1: {
			if (node.string && typeof value === 'string')
				return executeStructureString(node, value, scratch, 123)

			if (
				value === null ||
				typeof value !== 'object' ||
				Array.isArray(value)
			)
				return fail(node, scratch)
			if (!isProxy || isProxy(value)) return fail(node, scratch)

			const source = value as Record<string, unknown>
			const sourceKeys = Object.getOwnPropertyNames(source)
			for (const key of node.keys) {
				const descriptor = Object.getOwnPropertyDescriptor(source, key)
				if (
					(descriptor &&
						(!('value' in descriptor) || !descriptor.enumerable)) ||
					(!descriptor && key in source)
				)
					return fail(node, scratch)
			}
			if (node.additional === 2)
				for (const key of sourceKeys)
					if (!node.known.has(key)) return fail(node, scratch)

			const out: Record<string, unknown> = {}
			let defaulted = 0

			for (let i = 0; i < node.keys.length; i++) {
				const key = node.keys[i]
				const present = own(source, key)
				scratch.path.push(key)
				const result = executeValidationPlan(
					node.properties[i],
					present ? source[key] : undefined,
					scratch,
					mode
				)
				scratch.path.pop()

				if (result === VALIDATION_FAILED) return result
				if (
					result !== undefined ||
					(present && !node.properties[i].optional) ||
					(node.properties[i].hasDefault && !(mode & CHECK_ONLY))
				) {
					writeOwn(out, key, result)
					if (
						!present &&
						node.properties[i].hasDefault &&
						!(mode & CHECK_ONLY)
					)
						defaulted++
				} else if (node.required.has(key))
					return fail(node.properties[i], scratch)
			}
			const checkedCount = sourceKeys.length + defaulted
			if (
				(node.min !== undefined && checkedCount < node.min) ||
				(node.max !== undefined && checkedCount > node.max)
			)
				return fail(node, scratch)

			return out
		}
		case 2: {
			if (node.string && typeof value === 'string')
				return executeStructureString(node, value, scratch, 91)

			if (!Array.isArray(value)) return fail(node, scratch)
			if (!isProxy || isProxy(value)) return fail(node, scratch)
			if (Object.getPrototypeOf(value) !== Array.prototype)
				return fail(node, scratch)
			if (
				(node.min !== undefined && value.length < node.min) ||
				(node.max !== undefined && value.length > node.max)
			)
				return fail(node, scratch)

			const out = new Array(value.length)
			for (let i = 0; i < value.length; i++) {
				const descriptor = Object.getOwnPropertyDescriptor(value, i)
				if (!descriptor) return fail(node, scratch)
				if (!('value' in descriptor) || !descriptor.enumerable)
					return fail(node, scratch)
				scratch.path.push(i)
				const result = executeValidationPlan(
					node.items,
					descriptor.value,
					scratch,
					mode
				)
				scratch.path.pop()
				if (result === VALIDATION_FAILED) return result
				out[i] = result
			}
			return out
		}
		case 3:
			return typeof value === 'string' &&
				(node.min === undefined ||
					Guard.IsMinLength(value, node.min)) &&
				(node.max === undefined ||
					Guard.IsMaxLength(value, node.max)) &&
				(node.pattern === undefined || node.pattern.test(value))
				? value
				: fail(node, scratch)
		case 4: {
			if (
				typeof value === 'string' &&
				node.coerce &&
				(node.explicit || !(mode & SUPPRESS_IMPLICIT_COERCE))
			) {
				if (
					node.coerce === 2
						? integer.test(value)
						: decimal.test(value)
				)
					value = +value
			}

			if (
				!isFiniteNumber(value) ||
				(node.integer && !Number.isInteger(value)) ||
				(node.minimum !== undefined && value < node.minimum) ||
				(node.maximum !== undefined && value > node.maximum) ||
				(node.exclusiveMinimum !== undefined &&
					value <= node.exclusiveMinimum) ||
				(node.exclusiveMaximum !== undefined &&
					value >= node.exclusiveMaximum) ||
				(node.multipleOf !== undefined &&
					!Guard.IsMultipleOf(value, node.multipleOf))
			)
				return fail(node, scratch)

			return value
		}
		case 5:
			if (
				typeof value === 'string' &&
				node.coerce &&
				(node.explicit || !(mode & SUPPRESS_IMPLICIT_COERCE))
			)
				if (value === 'true') value = true
				else if (value === 'false') value = false
			return typeof value === 'boolean' ? value : fail(node, scratch)
		case 6:
			return value === null ? null : fail(node, scratch)
		case 7:
			return value === node.value ? value : fail(node, scratch)
	}
}

export interface ValidationPlanExtension {
	compose(schema: any, options: ValidatorOptions): Validator | undefined
	create(
		schema: TSchema,
		domain: ValidationPlanDomain,
		oracleFactory: () => any,
		query: boolean,
		options: ValidatorOptions,
		cached?: Validator
	): Validator | undefined
}

export class ValidationPlanValidator<
	const in out T extends TSchema = TSchema
> extends Validator {
	override isAsync = false
	override mayReturnPromise = false
	get [VALIDATION_PLAN_FUSED_QUERY]() {
		return (
			this.From === builtInValidationPlanFrom &&
			this.FromSync === builtInValidationPlanFromSync
		)
	}

	readonly schema: T
	readonly plan: ValidationPlan | undefined
	readonly hasCodec: boolean
	readonly hasDefault: boolean
	Clean: ((value: unknown) => unknown) | undefined

	#oracle?: any
	#oracleFactory?: () => any
	#compactSchema?: unknown
	#errorLocator?: CompactErrorLocator
	#sealed = false
	#jsonFastPath?: {
		check: (value: unknown) => boolean
		clean: (value: unknown) => unknown
	}

	constructor(
		schema: TSchema,
		plan: ValidationPlan,
		oracleFactory: (() => any) | undefined,
		query = false,
		jsonFastPath?: {
			check: (value: unknown) => boolean
			clean: (value: unknown) => unknown
		},
		semanticOptions?: ValidatorOptions
	) {
		super()
		this.schema = query
			? Object.defineProperty(
					Object.create(schema),
					VALIDATION_PLAN_QUERY,
					{ value: true }
				)
			: (schema as T)
		this.plan = jsonFastPath ? undefined : plan
		this.hasCodec = plan.coerced
		this.hasDefault = plan.hasDefault
		this.#oracleFactory = oracleFactory
		this.#jsonFastPath = jsonFastPath
		this.Clean = jsonFastPath
			? jsonFastPath.clean
			: (value) => this.#getOracle().Clean?.(value) ?? value

		const semanticSlot =
			semanticOptions?.semanticSlot ??
			semanticOptions?.slot ??
			(plan.encode ? 'response:200' : query ? 'query' : 'body')
		const response = semanticSlot.startsWith('response:')
		const policy: TypeBoxExecutionPolicy = {
			normalize:
				semanticOptions?.normalize === false
					? 'none'
					: semanticOptions?.normalize === 'typebox'
						? 'typebox'
						: 'exact',
			sanitize: !!semanticOptions?.sanitize,
			direction: response ? 'response' : 'request',
			domain: response ? 'response' : (semanticSlot as any),
			settlement: 'sync',
			clean: 'runtime',
			optional: plan.root.optional
				? plan.root.kind === 1
					? 'object'
					: 'value'
				: 'none',
			form: false,
			noValidate: false,
			diagnostics: 'locator'
		}
		attachValidatorSemanticSource(
			this,
			validationPlanSemantics(plan, policy)
		)
	}

	override seal(introspect: boolean) {
		if (this.#sealed) return
		const oracle = this.#jsonFastPath ? undefined : this.#getOracle()
		oracle?.seal?.(introspect)
		this.#oracleFactory = undefined

		this.#compactSchema = compactDiagnosticSchema(this.schema)
		this.#errorLocator = createCompactErrorLocator(this.schema)
		;(this as { schema?: unknown }).schema = undefined
		const semantics = readValidatorSemanticSource(this)
		if (semantics)
			attachValidatorSemanticSource(
				this,
				validatorSemanticsWithDiagnostics(semantics, 'compact')
			)
		this.#sealed = true
	}

	#getOracle() {
		if (this.#oracleFactory === undefined) return this.#oracle

		const oracle = this.#oracleFactory()
		this.#oracle = oracle
		this.#oracleFactory = undefined

		return oracle
	}

	[VALIDATION_PLAN_ORACLE](value: unknown, type?: string) {
		return this.#getOracle().FromSync(value, type)
	}

	Check(value: unknown): boolean {
		return (
			this.#jsonFastPath?.check(value) ?? this.#getOracle().Check(value)
		)
	}

	Errors(value: unknown): TLocalizedValidationError[] {
		return this.#jsonFastPath
			? this.schema
				? TypeBoxErrors(this.schema, value)
				: this.#compactSchema
					? (compactErrors(
							this.#compactSchema,
							value
						) as TLocalizedValidationError[])
					: (this.#errorLocator?.(
							value
						) as TLocalizedValidationError[])
			: this.#getOracle().Errors(value)
	}

	From(value: unknown, type?: string) {
		return this.FromSync(value, type)
	}

	FromSync(value: unknown, type?: string): any {
		if (this.#jsonFastPath) {
			if (this.#jsonFastPath.check(value))
				return this.#jsonFastPath.clean(value)

			throw new ValidationError(
				type,
				value,
				() => this.Errors(value),
				this.schema ?? this.#compactSchema
			)
		}

		const scratch: ValidationScratch = {
			pc: -1,
			path: [],
			failurePath: ''
		}
		const result = executeValidationPlan(this.plan!.root, value, scratch)

		if (result !== VALIDATION_FAILED) return result
		return this.#getOracle().FromSync(value, type)
	}

	async FromAsync(value: unknown, type?: string) {
		return this.FromSync(value, type)
	}

	Decode(value: unknown): any {
		return this.#jsonFastPath
			? Decode(this.schema, value)
			: this.#getOracle().Decode(value)
	}

	Encode(value: unknown): any {
		return this.#jsonFastPath ? value : this.#getOracle().Encode(value)
	}

	EncodeFrom(value: unknown, type?: string): any {
		if (this.#jsonFastPath) return this.FromSync(value, type)
		if (!this.plan!.encode) return this.#getOracle().EncodeFrom(value, type)

		const scratch: ValidationScratch = {
			pc: -1,
			path: [],
			failurePath: ''
		}
		const result = executeValidationPlan(this.plan!.root, value, scratch)

		if (result !== VALIDATION_FAILED) return result
		return this.#getOracle().EncodeFrom(value, type)
	}
}

const builtInValidationPlanFrom = ValidationPlanValidator.prototype.From
const builtInValidationPlanFromSync = ValidationPlanValidator.prototype.FromSync

export const validationPlan: ValidationPlanExtension = {
	compose(schema, options) {
		return [schema, ...options.schemas!].some((member) =>
			compositionNeedsLegacyFallback(member)
		)
			? undefined
			: new ValidationPlanMultiValidator(schema, options)
	},
	create(schema, domain, oracleFactory, query, options, cached) {
		if (domain === 'json') return
		if (domain === 'string' && schemaHasDangerousProperties(schema)) return
		if (Settings.Get().exactOptionalPropertyTypes) return
		if (cached) return cached

		const plan = createValidationPlan(schema, domain)
		if (!plan) return
		if (domain === 'string' || domain === 'encode')
			return new ValidationPlanValidator(
				schema,
				plan,
				oracleFactory,
				query,
				undefined,
				options
			)
		if (
			plan.coerced ||
			plan.hasDefault ||
			(schema as any).additionalProperties === false ||
			schemaHasDangerousProperties(schema)
		)
			return

		const check = compileCheck(schema)
		if (!check) return

		return new ValidationPlanValidator(
			schema,
			plan,
			undefined,
			false,
			{
				check,
				clean: createMirror(schema, { Compile }) as (
					value: unknown
				) => unknown
			},
			options
		)
	}
}

Object.defineProperty(validationPlan, VALIDATION_PLAN_BUILTIN, {
	value: true
})

const compileCheck = (schema: TSchema) => {
	const compiled = Compile(schema) as any
	const check = compiled.evaluateResult?.check
	return typeof check === 'function'
		? (check as (value: unknown) => boolean)
		: undefined
}

function compositionNeedsLegacyFallback(
	value: unknown,
	seen = new WeakSet<object>()
): boolean {
	if (!value || typeof value !== 'object' || seen.has(value)) return false
	if ('~standard' in value) return false
	seen.add(value)

	const kind = (value as any)['~kind']
	if (
		kind === 'Ref' ||
		kind === 'This' ||
		kind === 'Union' ||
		kind === 'Intersect' ||
		kind === 'Import' ||
		kind === 'Cyclic'
	)
		return true

	for (const key of Reflect.ownKeys(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key)
		if (!descriptor) continue
		if (!('value' in descriptor)) return true
		if (compositionNeedsLegacyFallback(descriptor.value, seen)) return true
	}

	return false
}
