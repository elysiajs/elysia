import {
	Evaluate,
	Instantiate,
	IsArray,
	IsCyclic,
	IsIntersect,
	IsObject,
	IsRecord,
	IsRef,
	IsTuple,
	IsUnion,
	RecordPattern,
	RecordValue,
	With,
	type TSchema
} from 'typebox/type'
import { Clone, UnionPrioritySort } from 'typebox/value'
import { Settings } from 'typebox/system'

import { compileDetachedCheck } from './detached-check'

type CleanStep = (value: unknown) => unknown
type SchemaContext = Record<string, TSchema>

type CleanNode =
	| { kind: 0 }
	| { kind: 1; item: CleanNode }
	| {
			kind: 2
			properties: Map<string, CleanNode>
			additional: 0 | 1 | 2
			additionalNode?: CleanNode
			additionalCheck?: (value: unknown) => boolean
	  }
	| {
			kind: 3
			pattern: RegExp
			value: CleanNode
			additional: 0 | 1 | 2
			additionalNode?: CleanNode
			additionalCheck?: (value: unknown) => boolean
	  }
	| { kind: 4; items: CleanNode[] }
	| {
			kind: 5
			variants: Array<{
				node: CleanNode
				check: (value: unknown) => boolean
			}>
	  }

const identity: CleanNode = { kind: 0 }

function executeClean(node: CleanNode, value: any): any {
	switch (node.kind) {
		case 0:
			return value
		case 1:
			return Array.isArray(value)
				? value.map((entry) => executeClean(node.item, entry))
				: value
		case 2:
			if (
				value === null ||
				typeof value !== 'object' ||
				Array.isArray(value)
			)
				return value
			for (const key of Object.getOwnPropertyNames(value)) {
				const property = node.properties.get(key)
				if (property) {
					value[key] = executeClean(property, value[key])
					continue
				}
				if (node.additional === 1) continue
				if (
					node.additional === 2 &&
					node.additionalCheck!(value[key])
				) {
					value[key] = executeClean(node.additionalNode!, value[key])
					continue
				}
				delete value[key]
			}
			return value
		case 3:
			if (value === null || typeof value !== 'object') return value
			for (const key of Object.getOwnPropertyNames(value)) {
				if (node.pattern.test(key)) {
					value[key] = executeClean(node.value, value[key])
					continue
				}
				if (node.additional === 1) continue
				if (
					node.additional === 2 &&
					node.additionalCheck!(value[key])
				) {
					value[key] = executeClean(node.additionalNode!, value[key])
					continue
				}
				delete value[key]
			}
			return value
		case 4: {
			if (!Array.isArray(value)) return value
			const length = Math.min(value.length, node.items.length)
			for (let index = 0; index < length; index++)
				value[index] = executeClean(node.items[index], value[index])
			return value.length > length ? value.slice(0, length) : value
		}
		case 5:
			for (const variant of node.variants) {
				const clean = executeClean(variant.node, Clone(value))
				if (variant.check(clean)) return clean
			}
			return value
	}
}

const createRunner =
	(root: CleanNode): CleanStep =>
	(value) =>
		executeClean(root, value)

/** Materializes TypeBox Clean without retaining the authoring schema. */
export function createCleanPlan(schema: TSchema): CleanStep {
	const sorted = Settings.Get().unionPrioritySort
		? UnionPrioritySort(schema)
		: schema
	const cache = new WeakMap<object, WeakMap<object, CleanNode>>()

	const build = (type: TSchema, context: SchemaContext): CleanNode => {
		if (!type || typeof type !== 'object') return identity
		let byContext = cache.get(type)
		if (!byContext) cache.set(type, (byContext = new WeakMap()))
		const cached = byContext.get(context)
		if (cached) return cached

		const slot: CleanNode = { kind: 0 }
		byContext.set(context, slot)
		let node: CleanNode = identity

		if (IsArray(type)) node = { kind: 1, item: build(type.items, context) }
		else if (IsCyclic(type)) {
			const next = { ...context, ...type.$defs } as SchemaContext
			node = next[type.$ref] ? build(next[type.$ref], next) : identity
		} else if (IsIntersect(type)) {
			const evaluated = Evaluate(Instantiate(context, type))
			const cleanType = IsObject(evaluated)
				? With(
						evaluated,
						Object.hasOwn(type, 'unevaluatedProperties')
							? {
									additionalProperties: (type as any)
										.unevaluatedProperties
								}
							: {}
					)
				: evaluated
			node = build(cleanType, context)
		} else if (IsObject(type)) {
			const properties = new Map<string, CleanNode>()
			for (const key of Object.getOwnPropertyNames(type.properties))
				properties.set(key, build(type.properties[key], context))
			const additional = (type as any).additionalProperties
			const additionalNode =
				additional && typeof additional === 'object'
					? build(additional, context)
					: undefined
			node = {
				kind: 2,
				properties,
				additional: additional === true ? 1 : additionalNode ? 2 : 0,
				additionalNode,
				additionalCheck: additionalNode
					? compileDetachedCheck(context, additional, 'clean')
					: undefined
			}
		} else if (IsRecord(type)) {
			const additional = (type as any).additionalProperties
			const additionalNode =
				additional && typeof additional === 'object'
					? build(additional, context)
					: undefined
			node = {
				kind: 3,
				pattern: new RegExp(RecordPattern(type)),
				value: build(RecordValue(type), context),
				additional: additional === true ? 1 : additionalNode ? 2 : 0,
				additionalNode,
				additionalCheck: additionalNode
					? compileDetachedCheck(context, additional, 'clean')
					: undefined
			}
		} else if (IsRef(type))
			node = context[type.$ref]
				? build(context[type.$ref], context)
				: identity
		else if (IsTuple(type))
			node = {
				kind: 4,
				items: type.items.map((item) => build(item, context))
			}
		else if (IsUnion(type))
			node = {
				kind: 5,
				variants: type.anyOf.map((variant) => ({
					node: build(variant, context),
					check: compileDetachedCheck(context, variant, 'clean')
				}))
			}

		Object.assign(slot, node)
		return slot
	}

	return createRunner(build(sorted, {}))
}
