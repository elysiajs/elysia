import {
	Composite,
	Evaluate,
	Interface,
	Mapped,
	Omit,
	Partial,
	Pick,
	ReadonlyObject,
	Required
} from '../typebox-type'
import { compositionKeys } from '../../utils'

// holds what cookie signing reads: `config`, `$ref` or a deferred action
const carries = (
	schema: any,
	field = false,
	seen = new Set<unknown>()
): boolean => {
	if (!schema || typeof schema !== 'object' || seen.has(schema)) return false

	seen.add(schema)

	if (
		schema.config !== undefined ||
		schema.$ref !== undefined ||
		schema['~kind'] === 'Deferred' ||
		compositionKeys.some(
			(key) =>
				Array.isArray(schema[key]) &&
				schema[key].some((member: unknown) =>
					carries(member, field, seen)
				)
		)
	)
		return true

	// `for..in` like the walk, inherited fields included
	if (!field)
		for (const name in schema.properties)
			if (carries(schema.properties[name], true)) return true

	return false
}

const from = (schema: any, sources: unknown[]): any =>
	Object.defineProperty(
		Object.create(
			Object.getPrototypeOf(schema),
			Object.getOwnPropertyDescriptors(schema)
		),
		'~cookieFrom',
		{ value: sources, writable: true, configurable: true }
	)

// TypeBox rebuilds the result and drops cookie config: record the inputs
// under a non-enumerable `~cookieFrom`, read like `allOf`
const keep = <F extends (...args: any[]) => any>(
	build: F,
	sourcesOf: (...args: any[]) => unknown[]
): F =>
	((...args: any[]) => {
		const sources = sourcesOf(...args)
		const result = build(...args)
		if (!sources.some((source) => carries(source))) return result

		const built = from(result, sources)
		const ref = built.$ref
		const replaced = (sources[0] as any)?.$defs?.[ref]

		// t.Cyclic: the rewritten `$defs` entry records the one it replaced
		if (replaced && built.$defs?.[ref] && built.$defs[ref] !== replaced)
			built.$defs = {
				...built.$defs,
				[ref]: from(built.$defs[ref], [replaced])
			}

		return built
	}) as F

const operand = (type: unknown, options: unknown) => [type, options]
const indexed = (type: unknown, _: unknown, options: unknown) => [type, options]

export const CompositeType: typeof Composite = /* @__PURE__ */ keep(
	Composite,
	(left, right) => [left, right]
)
export const EvaluateType: typeof Evaluate = /* @__PURE__ */ keep(
	Evaluate,
	operand
)
export const InterfaceType: typeof Interface = /* @__PURE__ */ keep(
	Interface,
	(heritage, properties, options) => [...heritage, { properties }, options]
)
export const MappedType: typeof Mapped = /* @__PURE__ */ keep(
	Mapped,
	(_, type, __, property, options) => [type, property, options]
)
export const OmitType: typeof Omit = /* @__PURE__ */ keep(Omit, indexed)
export const PartialType: typeof Partial = /* @__PURE__ */ keep(
	Partial,
	operand
)
export const PickType: typeof Pick = /* @__PURE__ */ keep(Pick, indexed)
export const ReadonlyObjectType: typeof ReadonlyObject = /* @__PURE__ */ keep(
	ReadonlyObject,
	operand
)
export const RequiredType: typeof Required = /* @__PURE__ */ keep(
	Required,
	operand
)
