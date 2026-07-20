import {
	Evaluate,
	Instantiate,
	IsArray,
	IsBigInt,
	IsBoolean,
	IsCyclic,
	IsEnum,
	IsInteger,
	IsIntersect,
	IsLiteral,
	IsNull,
	IsNumber,
	IsObject,
	IsOptional,
	IsRecord,
	IsRef,
	IsString,
	IsTemplateLiteral,
	IsTuple,
	IsUndefined,
	IsUnion,
	IsVoid,
	RecordPattern,
	RecordValue,
	type TSchema
} from 'typebox/type'
import { Clone } from 'typebox/value'
import { Guard } from 'typebox/guard'

import { compileDetachedCheck } from './detached-check'

type ConvertStep = (value: unknown) => unknown
type SchemaContext = Record<string, TSchema>

type ConvertNode =
	| { kind: 0 }
	| { kind: 1; convert: 1 | 2 | 3 | 4 | 5 | 6 | 7 }
	| { kind: 2; value: bigint | boolean | number | string }
	| { kind: 3; item: ConvertNode }
	| {
			kind: 4
			properties: Array<{
				pattern: RegExp
				optional: boolean
				node: ConvertNode
			}>
			additional?: ConvertNode
	  }
	| { kind: 5; pattern: RegExp; value: ConvertNode; additional?: ConvertNode }
	| { kind: 6; items: ConvertNode[] }
	| {
			kind: 7
			check: (value: unknown) => boolean
			variants: ConvertNode[]
	  }
	| { kind: 8; child: ConvertNode }

const identity: ConvertNode = { kind: 0 }

const tryBigInt = (value: unknown): bigint | undefined => {
	if (typeof value === 'bigint') return value
	if (typeof value === 'boolean') return value ? 1n : 0n
	if (typeof value === 'number' && Number.isFinite(value))
		return BigInt(Math.trunc(value))
	if (value === null || value === undefined) return 0n
	if (typeof value !== 'string') return
	if (/^-?(0|[1-9]\d*)n$/.test(value)) return BigInt(value.slice(0, -1))
	if (/^-?(0|[1-9]\d*)\.\d+$/.test(value)) return BigInt(value.split('.')[0])
	if (/^-?(0|[1-9]\d*)$/.test(value)) return BigInt(value)
	if (value.toLowerCase() === 'false') return 0n
	if (value.toLowerCase() === 'true') return 1n
}

const tryBoolean = (value: unknown): boolean | undefined => {
	if (typeof value === 'boolean') return value
	if (value === null || value === undefined) return false
	if (value === 0 || value === 0n) return false
	if (value === 1 || value === 1n) return true
	if (typeof value !== 'string') return
	if (value.toLowerCase() === 'false' || value === '0') return false
	if (value.toLowerCase() === 'true' || value === '1') return true
}

const tryNumber = (value: unknown): number | undefined => {
	if (typeof value === 'number' && Number.isFinite(value)) return value
	if (typeof value === 'boolean') return value ? 1 : 0
	if (value === null || value === undefined) return 0
	if (typeof value === 'bigint')
		return value <= BigInt(Number.MAX_SAFE_INTEGER) &&
			value >= BigInt(Number.MIN_SAFE_INTEGER)
			? Number(value)
			: undefined
	if (typeof value !== 'string') return
	const number = +value
	if (Number.isFinite(number)) return number
	if (value.toLowerCase() === 'false') return 0
	if (value.toLowerCase() === 'true') return 1
	const bigint = tryBigInt(value)
	return bigint !== undefined &&
		bigint <= BigInt(Number.MAX_SAFE_INTEGER) &&
		bigint >= BigInt(Number.MIN_SAFE_INTEGER)
		? Number(bigint)
		: undefined
}

const tryString = (value: unknown): string | undefined => {
	if (
		typeof value === 'bigint' ||
		typeof value === 'boolean' ||
		(typeof value === 'number' && Number.isFinite(value))
	)
		return value.toString()
	if (value === null) return 'null'
	if (value === undefined) return ''
	return typeof value === 'string' ? value : undefined
}

const tryNull = (value: unknown): null | undefined => {
	if (
		value === null ||
		value === undefined ||
		value === false ||
		value === 0 ||
		value === 0n
	)
		return null
	if (typeof value !== 'string') return
	const lower = value.toLowerCase()
	return lower === 'undefined' ||
		lower === 'null' ||
		value === '' ||
		value === '0'
		? null
		: undefined
}

const tryUndefined = (value: unknown): [boolean, undefined] => {
	if (
		value === undefined ||
		value === null ||
		value === false ||
		value === 0 ||
		value === 0n
	)
		return [true, undefined]
	if (typeof value !== 'string') return [false, undefined]
	const lower = value.toLowerCase()
	return [
		lower === 'undefined' ||
			lower === 'null' ||
			value === '' ||
			value === '0',
		undefined
	]
}

function convertPrimitive(kind: number, value: unknown): unknown {
	switch (kind) {
		case 1:
			return tryBigInt(value) ?? value
		case 2:
			return tryBoolean(value) ?? value
		case 3: {
			const converted = tryNumber(value)
			return converted === undefined ? value : Math.trunc(converted)
		}
		case 4:
			return tryNull(value) === null ? null : value
		case 5:
			return tryNumber(value) ?? value
		case 6:
			return tryString(value) ?? value
		case 7: {
			const [ok, converted] = tryUndefined(value)
			return ok ? converted : value
		}
		default:
			return value
	}
}

function executeConvert(node: ConvertNode, value: any): any {
	switch (node.kind) {
		case 0:
			return value
		case 1:
			return convertPrimitive(node.convert, value)
		case 2: {
			if (value === node.value) return value
			const converted =
				typeof node.value === 'bigint'
					? tryBigInt(value)
					: typeof node.value === 'boolean'
						? tryBoolean(value)
						: typeof node.value === 'number'
							? tryNumber(value)
							: tryString(value)
			return converted === node.value ? converted : value
		}
		case 3:
			return (Array.isArray(value) ? value : [value]).map((entry) =>
				executeConvert(node.item, entry)
			)
		case 4:
			if (!Guard.IsObjectNotArray(value)) return value
			for (const property of node.properties)
				for (const key of Object.getOwnPropertyNames(value)) {
					if (!property.pattern.test(key)) continue
					if (property.optional && value[key] === undefined) continue
					value[key] = executeConvert(property.node, value[key])
				}
			if (node.additional)
				for (const property of node.properties)
					for (const key of Object.getOwnPropertyNames(value))
						if (!property.pattern.test(key))
							value[key] = executeConvert(
								node.additional,
								value[key]
							)
			return value
		case 5:
			if (!Guard.IsObjectNotArray(value)) return value
			for (const key of Object.getOwnPropertyNames(value))
				if (node.pattern.test(key))
					value[key] = executeConvert(node.value, value[key])
			if (node.additional)
				for (const key of Object.getOwnPropertyNames(value))
					if (!node.pattern.test(key))
						value[key] = executeConvert(node.additional, value[key])
			return value
		case 6:
			if (Array.isArray(value))
				for (
					let index = 0;
					index < Math.min(node.items.length, value.length);
					index++
				)
					value[index] = executeConvert(
						node.items[index],
						value[index]
					)
			return value
		case 7:
			if (node.check(value)) return value
			for (const variant of node.variants) {
				const converted = executeConvert(variant, Clone(value))
				if (node.check(converted)) return converted
			}
			return value
		case 8:
			return executeConvert(node.child, value)
	}
}

const createRunner =
	(root: ConvertNode): ConvertStep =>
	(value) =>
		executeConvert(root, value)

/** Materializes TypeBox Convert without retaining the authoring schema. */
export function createConvertPlan(schema: TSchema): ConvertStep {
	const cache = new WeakMap<object, WeakMap<object, ConvertNode>>()

	const build = (type: TSchema, context: SchemaContext): ConvertNode => {
		if (!type || typeof type !== 'object') return identity
		let byContext = cache.get(type)
		if (!byContext) cache.set(type, (byContext = new WeakMap()))
		const cached = byContext.get(context)
		if (cached) return cached

		const slot: ConvertNode = { kind: 0 }
		byContext.set(context, slot)
		let node: ConvertNode = slot

		if (IsArray(type)) node = { kind: 3, item: build(type.items, context) }
		else if (IsBigInt(type)) node = { kind: 1, convert: 1 }
		else if (IsBoolean(type)) node = { kind: 1, convert: 2 }
		else if (IsCyclic(type)) {
			const next = { ...context, ...type.$defs } as SchemaContext
			node = {
				kind: 8,
				child: next[type.$ref] ? build(next[type.$ref], next) : identity
			}
		} else if (IsEnum(type) || IsTemplateLiteral(type))
			node = { kind: 8, child: build(Evaluate(type), context) }
		else if (IsInteger(type)) node = { kind: 1, convert: 3 }
		else if (IsIntersect(type))
			node = {
				kind: 8,
				child: build(Evaluate(Instantiate(context, type)), context)
			}
		else if (IsLiteral(type)) node = { kind: 2, value: type.const }
		else if (IsNull(type)) node = { kind: 1, convert: 4 }
		else if (IsNumber(type)) node = { kind: 1, convert: 5 }
		else if (IsObject(type)) {
			const properties = Object.getOwnPropertyNames(type.properties).map(
				(key) => ({
					pattern: new RegExp(`^${key}$`),
					optional: IsOptional(type.properties[key]),
					node: build(type.properties[key], context)
				})
			)
			const additional = (type as any).additionalProperties
			node = {
				kind: 4,
				properties,
				additional:
					additional && typeof additional === 'object'
						? build(additional, context)
						: undefined
			}
		} else if (IsRecord(type)) {
			const additional = (type as any).additionalProperties
			node = {
				kind: 5,
				pattern: new RegExp(RecordPattern(type)),
				value: build(RecordValue(type), context),
				additional:
					additional && typeof additional === 'object'
						? build(additional, context)
						: undefined
			}
		} else if (IsRef(type))
			node = {
				kind: 8,
				child: context[type.$ref]
					? build(context[type.$ref], context)
					: identity
			}
		else if (IsString(type)) node = { kind: 1, convert: 6 }
		else if (IsTuple(type))
			node = {
				kind: 6,
				items: type.items.map((item) => build(item, context))
			}
		else if (IsUndefined(type) || IsVoid(type))
			node = { kind: 1, convert: 7 }
		else if (IsUnion(type))
			node = {
				kind: 7,
				check: compileDetachedCheck(context, type, 'convert'),
				variants: type.anyOf.map((variant) => build(variant, context))
			}

		Object.assign(slot, node)
		return slot
	}

	return createRunner(build(schema, {}))
}
