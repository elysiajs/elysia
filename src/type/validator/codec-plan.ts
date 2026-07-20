import {
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
import { Clone, UnionPrioritySort } from 'typebox/value'
import { Settings } from 'typebox/system'
import { Guard } from 'typebox/guard'

import { createCleanPlan } from './clean-plan'
import { compileDetachedCheck } from './detached-check'

type DecodeStep = (value: any) => any
type SchemaContext = Record<string, TSchema>

type DecodeNode =
	| { kind: 0; decode?: DecodeStep }
	| { kind: 1; decode?: DecodeStep; item: DecodeNode }
	| { kind: 2; decode?: DecodeStep; child: DecodeNode }
	| {
			kind: 3
			decode?: DecodeStep
			members: Array<{ clean: DecodeStep; node: DecodeNode }>
	  }
	| {
			kind: 4
			decode?: DecodeStep
			properties: Array<{
				key: string
				optional: boolean
				node: DecodeNode
			}>
	  }
	| { kind: 5; decode?: DecodeStep; pattern: RegExp; value: DecodeNode }
	| { kind: 6; decode?: DecodeStep; items: DecodeNode[] }
	| {
			kind: 7
			decode?: DecodeStep
			variants: Array<{
				check: (value: unknown) => boolean
				node: DecodeNode
			}>
	  }

const identity: DecodeNode = { kind: 0 }

const callback = (node: DecodeNode, value: any) =>
	node.decode ? node.decode(value) : value

function executeDecode(node: DecodeNode, value: any): any {
	switch (node.kind) {
		case 0:
			return callback(node, value)
		case 1:
			if (Array.isArray(value))
				for (let index = 0; index < value.length; index++)
					value[index] = executeDecode(node.item, value[index])
			return callback(node, value)
		case 2:
			return callback(node, executeDecode(node.child, value))
		case 3: {
			if (!node.members.length) return callback(node, value)
			const interiors = node.members.map(({ clean, node }) =>
				executeDecode(node, clean(Clone(value)))
			)
			const exterior = interiors.every(Guard.IsObject)
				? Object.assign({}, ...interiors)
				: (interiors.find(
						(entry) => !Guard.IsDeepEqual(value, entry)
					) ?? value)
			return callback(node, exterior)
		}
		case 4:
			if (Guard.IsObjectNotArray(value))
				for (const property of node.properties) {
					if (!Guard.HasPropertyKey(value, property.key)) continue
					// Mirrors TypeBox IsOptionalUndefined exactly. With exact optional
					// types enabled, the preceding Check rejects this value first.
					if (property.optional && value[property.key] === undefined)
						continue
					value[property.key] = executeDecode(
						property.node,
						value[property.key]
					)
				}
			return callback(node, value)
		case 5:
			if (Guard.IsObjectNotArray(value))
				for (const key of Object.getOwnPropertyNames(value))
					if (node.pattern.test(key))
						value[key] = executeDecode(node.value, value[key])
			return callback(node, value)
		case 6:
			if (Array.isArray(value))
				for (
					let index = 0;
					index < Math.min(node.items.length, value.length);
					index++
				)
					value[index] = executeDecode(
						node.items[index],
						value[index]
					)
			return callback(node, value)
		case 7:
			for (const variant of node.variants)
				if (variant.check(value))
					return callback(node, executeDecode(variant.node, value))
			return value
	}
}

function executeEncode(node: DecodeNode, value: any): any {
	switch (node.kind) {
		case 0:
			return callback(node, value)
		case 1: {
			const exterior = callback(node, value)
			if (Array.isArray(exterior))
				for (let index = 0; index < exterior.length; index++)
					exterior[index] = executeEncode(node.item, exterior[index])
			return exterior
		}
		case 2:
			return executeEncode(node.child, callback(node, value))
		case 3: {
			if (!node.members.length) return callback(node, value)
			const exterior = callback(node, value)
			const interiors = node.members.map(({ clean, node }) =>
				executeEncode(node, clean(Clone(exterior)))
			)
			return interiors.every(Guard.IsObject)
				? Object.assign({}, ...interiors)
				: (interiors.find(
						(entry) => !Guard.IsDeepEqual(exterior, entry)
					) ?? exterior)
		}
		case 4: {
			const exterior = callback(node, value)
			if (Guard.IsObjectNotArray(exterior))
				for (const property of node.properties) {
					if (!Guard.HasPropertyKey(exterior, property.key)) continue
					if (
						property.optional &&
						exterior[property.key] === undefined
					)
						continue
					exterior[property.key] = executeEncode(
						property.node,
						exterior[property.key]
					)
				}
			return exterior
		}
		case 5: {
			const exterior = callback(node, value)
			if (Guard.IsObjectNotArray(exterior))
				for (const key of Object.getOwnPropertyNames(exterior))
					if (node.pattern.test(key))
						exterior[key] = executeEncode(node.value, exterior[key])
			return exterior
		}
		case 6: {
			const exterior = callback(node, value)
			// This intentionally returns the original input to match TypeBox.
			if (!Array.isArray(exterior)) return value
			for (
				let index = 0;
				index < Math.min(node.items.length, exterior.length);
				index++
			)
				exterior[index] = executeEncode(
					node.items[index],
					exterior[index]
				)
			return exterior
		}
		case 7: {
			const exterior = callback(node, value)
			for (const variant of node.variants) {
				const encoded = executeEncode(variant.node, Clone(exterior))
				if (variant.check(encoded)) return encoded
			}
			return exterior
		}
	}
}

const createRunner =
	(root: DecodeNode): DecodeStep =>
	(value) =>
		executeDecode(root, value)

const createEncodeRunner =
	(root: DecodeNode): DecodeStep =>
	(value) =>
		executeEncode(root, value)

function createCodecPlan(
	schema: TSchema,
	direction: 'decode' | 'encode'
): DecodeStep {
	const sorted = Settings.Get().unionPrioritySort
		? UnionPrioritySort(schema)
		: schema
	const cache = new WeakMap<object, WeakMap<object, DecodeNode>>()

	const build = (type: TSchema, context: SchemaContext): DecodeNode => {
		if (!type || typeof type !== 'object') return identity
		let byContext = cache.get(type)
		if (!byContext) cache.set(type, (byContext = new WeakMap()))
		const cached = byContext.get(context)
		if (cached) return cached

		const decode = (type as any)['~codec']?.[direction] as
			| DecodeStep
			| undefined
		const slot: DecodeNode = { kind: 0, decode }
		byContext.set(context, slot)
		let node: DecodeNode = slot

		if (IsArray(type))
			node = { kind: 1, decode, item: build(type.items, context) }
		else if (IsCyclic(type)) {
			const next = { ...context, ...type.$defs } as SchemaContext
			node = {
				kind: 2,
				decode,
				child: next[type.$ref] ? build(next[type.$ref], next) : identity
			}
		} else if (IsIntersect(type))
			node = {
				kind: 3,
				decode,
				members: type.allOf.map((member) => ({
					clean: createCleanPlan(member),
					node: build(member, context)
				}))
			}
		else if (IsObject(type))
			node = {
				kind: 4,
				decode,
				properties: Object.getOwnPropertyNames(type.properties).map(
					(key) => ({
						key,
						optional: IsOptional(type.properties[key]),
						node: build(type.properties[key], context)
					})
				)
			}
		else if (IsRecord(type))
			node = {
				kind: 5,
				decode,
				pattern: new RegExp(RecordPattern(type)),
				value: build(RecordValue(type), context)
			}
		else if (IsRef(type))
			node = {
				kind: 2,
				decode,
				child: context[type.$ref]
					? build(context[type.$ref], context)
					: identity
			}
		else if (IsTuple(type))
			node = {
				kind: 6,
				decode,
				items: type.items.map((item) => build(item, context))
			}
		else if (IsUnion(type))
			node = {
				kind: 7,
				decode,
				variants: type.anyOf.map((variant) => ({
					check: compileDetachedCheck(context, variant, 'codec'),
					node: build(variant, context)
				}))
			}

		Object.assign(slot, node)
		return slot
	}

	const root = build(sorted, {})
	return direction === 'decode'
		? createRunner(root)
		: createEncodeRunner(root)
}

/** Materializes the callback-only DecodeUnsafe traversal. */
export const createDecodePlan = (schema: TSchema): DecodeStep =>
	createCodecPlan(schema, 'decode')

/** Materializes the callback-only EncodeUnsafe traversal. */
export const createEncodePlan = (schema: TSchema): DecodeStep =>
	createCodecPlan(schema, 'encode')
