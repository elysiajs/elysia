import {
	Evaluate,
	Instantiate,
	IsArray,
	IsCyclic,
	IsIntersect,
	IsObject,
	IsOptional,
	IsRecord,
	IsRef,
	IsTuple,
	IsUnion,
	RecordPattern,
	RecordValue,
	type TSchema
} from 'typebox/type'
import { Clone } from 'typebox/value'

import { compileDetachedCheck } from './detached-check'

type DefaultStep = (value: unknown) => unknown
type SchemaContext = Record<string, TSchema>

interface DefaultValue {
	has: boolean
	value: unknown
	call: boolean
}

type DefaultNode =
	| { kind: 0; default: DefaultValue }
	| { kind: 1; default: DefaultValue; item: DefaultNode }
	| {
			kind: 2
			default: DefaultValue
			properties: Array<{
				key: string
				node: DefaultNode
				assignUndefined: boolean
			}>
			known: Set<string>
			additional?: DefaultNode
	  }
	| {
			kind: 3
			default: DefaultValue
			pattern: RegExp
			value: DefaultNode
			valueHasDefault: boolean
			additional?: DefaultNode
	  }
	| { kind: 4; default: DefaultValue; items: DefaultNode[] }
	| {
			kind: 5
			default: DefaultValue
			variants: Array<{
				node: DefaultNode
				check: (value: unknown) => boolean
			}>
	  }
	| { kind: 6; default: DefaultValue; child: DefaultNode }

const noDefault: DefaultValue = { has: false, value: undefined, call: false }
const identity: DefaultNode = { kind: 0, default: noDefault }

function applyDefault(spec: DefaultValue, value: any) {
	if (!spec.has || value !== undefined) return value
	return spec.call ? (spec.value as () => unknown)() : Clone(spec.value)
}

function executeDefault(node: DefaultNode, value: any): any {
	value = applyDefault(node.default, value)
	switch (node.kind) {
		case 0:
			return value
		case 1:
			if (Array.isArray(value))
				for (let index = 0; index < value.length; index++)
					value[index] = executeDefault(node.item, value[index])
			return value
		case 2:
			if (value === null || typeof value !== 'object') return value
			for (const property of node.properties) {
				const result = executeDefault(
					property.node,
					value[property.key]
				)
				if (result !== undefined || property.assignUndefined)
					value[property.key] = result
			}
			if (node.additional)
				for (const key of Object.getOwnPropertyNames(value))
					if (!node.known.has(key))
						value[key] = executeDefault(node.additional, value[key])
			return value
		case 3:
			if (value === null || typeof value !== 'object') return value
			for (const key of Object.getOwnPropertyNames(value))
				if (node.pattern.test(key)) {
					if (node.valueHasDefault)
						value[key] = executeDefault(node.value, value[key])
				} else if (node.additional)
					value[key] = executeDefault(node.additional, value[key])
			return value
		case 4:
			if (Array.isArray(value))
				for (let index = 0; index < node.items.length; index++)
					value[index] = executeDefault(
						node.items[index],
						value[index]
					)
			return value
		case 5:
			for (const variant of node.variants) {
				const result = executeDefault(variant.node, Clone(value))
				if (variant.check(result)) return result
			}
			return value
		case 6:
			return executeDefault(node.child, value)
	}
}

const createRunner =
	(root: DefaultNode): DefaultStep =>
	(value) =>
		executeDefault(root, value)

/** Materializes TypeBox Default without retaining the authoring schema. */
export function createDefaultPlan(schema: TSchema): DefaultStep {
	const cache = new WeakMap<object, WeakMap<object, DefaultNode>>()

	const build = (type: TSchema, context: SchemaContext): DefaultNode => {
		if (!type || typeof type !== 'object') return identity
		let byContext = cache.get(type)
		if (!byContext) cache.set(type, (byContext = new WeakMap()))
		const cached = byContext.get(context)
		if (cached) return cached

		const has = Object.hasOwn(type, 'default')
		const value = has ? (type as any).default : undefined
		const spec: DefaultValue = {
			has,
			value,
			call: typeof value === 'function'
		}
		const slot: DefaultNode = { kind: 0, default: spec }
		byContext.set(context, slot)
		let node: DefaultNode = slot

		if (IsArray(type))
			node = { kind: 1, default: spec, item: build(type.items, context) }
		else if (IsCyclic(type)) {
			const next = { ...context, ...type.$defs } as SchemaContext
			node = {
				kind: 6,
				default: spec,
				child: next[type.$ref] ? build(next[type.$ref], next) : identity
			}
		} else if (IsIntersect(type))
			node = {
				kind: 6,
				default: spec,
				child: build(Evaluate(Instantiate(context, type)), context)
			}
		else if (IsObject(type)) {
			const properties = Object.getOwnPropertyNames(type.properties).map(
				(key) => {
					const property = type.properties[key]
					return {
						key,
						node: build(property, context),
						assignUndefined:
							!IsOptional(property) &&
							Object.hasOwn(property, 'default')
					}
				}
			)
			const additional = (type as any).additionalProperties
			node = {
				kind: 2,
				default: spec,
				properties,
				known: new Set(properties.map(({ key }) => key)),
				additional:
					additional && typeof additional === 'object'
						? build(additional, context)
						: undefined
			}
		} else if (IsRecord(type)) {
			const recordSchema = RecordValue(type)
			const additional = (type as any).additionalProperties
			node = {
				kind: 3,
				default: spec,
				pattern: new RegExp(RecordPattern(type)),
				value: build(recordSchema, context),
				valueHasDefault: Object.hasOwn(recordSchema, 'default'),
				additional:
					additional && typeof additional === 'object'
						? build(additional, context)
						: undefined
			}
		} else if (IsRef(type))
			node = {
				kind: 6,
				default: spec,
				child: context[type.$ref]
					? build(context[type.$ref], context)
					: identity
			}
		else if (IsTuple(type))
			node = {
				kind: 4,
				default: spec,
				items: type.items.map((item) => build(item, context))
			}
		else if (IsUnion(type))
			node = {
				kind: 5,
				default: spec,
				variants: type.anyOf.map((variant) => ({
					node: build(variant, context),
					check: compileDetachedCheck(context, variant, 'default')
				}))
			}

		Object.assign(slot, node)
		return slot
	}

	return createRunner(build(schema, {}))
}
