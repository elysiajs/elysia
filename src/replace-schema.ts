import { Kind, type TAnySchema, type TSchema } from "@sinclair/typebox";
import { t } from "./type-system";
import type { MaybeArray } from "./types";

export interface ReplaceSchemaTypeOptions {
	from: TSchema;
	to(schema: TSchema): TSchema | null;
	excludeRoot?: boolean;
	rootOnly?: boolean;
	original?: TAnySchema;
	/**
	 * Traverse until object is found except root object
	 **/
	untilObjectFound?: boolean;
	/**
	 * Only replace first object type, can be paired with excludeRoot
	 **/
	onlyFirst?: "object" | "array" | (string & {});
}

/**
 * Replace schema types with custom transformation
 *
 * @param schema - The schema to transform
 * @param options - Transformation options (single or array)
 * @returns Transformed schema
 *
 * @example
 * // Transform Object to ObjectString
 * replaceSchemaType(schema, {
 *   from: t.Object({}),
 *   to: (s) => t.ObjectString(s.properties || {}, s),
 *   excludeRoot: true,
 *   onlyFirst: 'object'
 * })
 */
export const replaceSchemaTypeFromManyOptions = (
	schema: TSchema,
	options: MaybeArray<ReplaceSchemaTypeOptions>,
): TSchema => {
	if (Array.isArray(options)) {
		let result = schema;
		for (const option of options) {
			result = replaceSchemaTypeFromOption(result, option);
		}
		return result;
	}

	return replaceSchemaTypeFromOption(schema, options);
};

const replaceSchemaTypeFromOption = (
	schema: TSchema,
	option: ReplaceSchemaTypeOptions,
): TSchema => {
	if (option.rootOnly && option.excludeRoot) {
		throw new Error("Can't set both rootOnly and excludeRoot");
	}
	if (option.rootOnly && option.onlyFirst) {
		throw new Error("Can't set both rootOnly and onlyFirst");
	}
	if (option.rootOnly && option.untilObjectFound) {
		throw new Error("Can't set both rootOnly and untilObjectFound");
	}

	type WalkProps = { s: TSchema; isRoot: boolean; treeLvl: number };
	const walk = ({ s, isRoot, treeLvl }: WalkProps): TSchema => {
		if (!s) return s;
		// console.log("walk iteration", { s, isRoot, treeLvl, transformTo: option.to.toString() })

		const skipRoot = isRoot && option.excludeRoot;
		const fromKind = option.from[Kind];

		// Double-wrapping check
		if (s.elysiaMeta) {
			const fromElysiaMeta = option.from.elysiaMeta;
			if (fromElysiaMeta === s.elysiaMeta && !skipRoot) {
				return option.to(s) as TSchema;
			}
			return s;
		}

		const shouldTransform = fromKind && s[Kind] === fromKind;
		if (!skipRoot && option.onlyFirst && s.type === option.onlyFirst) {
			if (shouldTransform) {
				return option.to(s) as TSchema;
			}
			return s
		}

		if (isRoot && option.rootOnly) {
			if (shouldTransform) {
				return option.to(s) as TSchema;
			}
			return s;
		}

		if (!isRoot && option.untilObjectFound && s.type === "object") {
			return s;
		}

		const newWalkInput = { isRoot: false, treeLvl: treeLvl + 1 };
		const withTransformedChildren = { ...s };

		if (s.oneOf) {
			withTransformedChildren.oneOf = s.oneOf.map((x: TSchema) =>
				walk({ ...newWalkInput, s: x }),
			);
		}
		if (s.anyOf) {
			withTransformedChildren.anyOf = s.anyOf.map((x: TSchema) =>
				walk({ ...newWalkInput, s: x }),
			);
		}
		if (s.allOf) {
			withTransformedChildren.allOf = s.allOf.map((x: TSchema) =>
				walk({ ...newWalkInput, s: x }),
			);
		}
		if (s.not) {
			withTransformedChildren.not = walk({ ...newWalkInput, s: s.not });
		}

		if (s.properties) {
			withTransformedChildren.properties = {};
			for (const [k, v] of Object.entries(s.properties)) {
				withTransformedChildren.properties[k] = walk({
					...newWalkInput,
					s: v as TSchema,
				});
			}
		}

		if (s.items) {
			const items = s.items;
			withTransformedChildren.items = Array.isArray(items)
				? items.map((x: TSchema) => walk({ ...newWalkInput, s: x }))
				: walk({ ...newWalkInput, s: items as TSchema });
		}

		// Transform THIS node (with children already transformed)
		const shouldTransformThis =
			!skipRoot && fromKind && withTransformedChildren[Kind] === fromKind;
		if (shouldTransformThis) {
			return option.to(withTransformedChildren) as TSchema;
		}

		return withTransformedChildren;
	};

	return walk({ s: schema, isRoot: true, treeLvl: 0 });
};

/**
 * Helper: Extract plain Object from ObjectString
 *
 * @example
 * ObjectString structure:
 * {
 *   elysiaMeta: "ObjectString",
 *   anyOf: [
 *     { type: "string", format: "ObjectString" },  // ← String branch
 *     { type: "object", properties: {...} }        // ← Object branch (we want this)
 *   ]
 * }
 */
export const extractObjectFromObjectString = (schema: TSchema): TSchema => {
	if (schema.elysiaMeta !== "ObjectString") return schema;

	const anyOf = schema.anyOf;
	if (!anyOf?.[1]) return schema;

	// anyOf[1] is the object branch (already clean, no elysiaMeta)
	return anyOf[1];
};

/**
 * Helper: Extract plain Array from ArrayString
 *
 * @example
 * ArrayString structure:
 * {
 *   elysiaMeta: "ArrayString",
 *   anyOf: [
 *     { type: "string", format: "ArrayString" },  // ← String branch
 *     { type: "array", items: {...} }             // ← Array branch (we want this)
 *   ]
 * }
 */

export const extractArrayFromArrayString = (schema: TSchema): TSchema => {
	if (schema.elysiaMeta !== "ArrayString") return schema;

	const anyOf = schema.anyOf;
	if (!anyOf?.[1]) return schema;

	// anyOf[1] is the array branch (already clean, no elysiaMeta)
	return anyOf[1];
};

let _stringToStructureCoercions: ReplaceSchemaTypeOptions[];

export const stringToStructureCoercions = () => {
	if (!_stringToStructureCoercions) {
		_stringToStructureCoercions = [
			{
				from: t.Object({}),
				to: (schema) => t.ObjectString(schema.properties || {}, schema),
				excludeRoot: true,
			},
			{
				from: t.Array(t.Any()),
				to: (schema) => t.ArrayString(schema.items || t.Any(), schema),
			},
		] satisfies ReplaceSchemaTypeOptions[];
	}

	return _stringToStructureCoercions;
};

let _queryCoercions: ReplaceSchemaTypeOptions[];

export const queryCoercions = () => {
	if (!_queryCoercions) {
		_queryCoercions = [
			{
				from: t.Object({}),
				to: (schema) => t.ObjectString(schema.properties || {}, schema),
				excludeRoot: true,
			},
			{
				from: t.Array(t.Any()),
				to: (schema) => t.ArrayQuery(schema.items || t.Any(), schema),
			},
		] satisfies ReplaceSchemaTypeOptions[];
	}

	return _queryCoercions;
};

let _coercePrimitiveRoot: ReplaceSchemaTypeOptions[];

export const coercePrimitiveRoot = () => {
	if (!_coercePrimitiveRoot)
		_coercePrimitiveRoot = [
			{
				from: t.Number(),
				to: (schema) => t.Numeric(schema),
				rootOnly: true,
			},
			{
				from: t.Boolean(),
				to: (schema) => t.BooleanString(schema),
				rootOnly: true,
			},
		] satisfies ReplaceSchemaTypeOptions[];

	return _coercePrimitiveRoot;
};
