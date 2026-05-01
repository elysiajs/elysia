// Start at 1 to prevent falsy value check
export const ELYSIA_TYPES = {
	Numeric: 1,
	Integer: 2,
	BooleanString: 3,
	ObjectString: 4,
	ArrayString: 5,
	Date: 6,
	Nullable: 7,
	MaybeEmpty: 8,
	UnionEnum: 9,
	File: 10,
	Files: 11,
	Form: 12,
	ArrayBuffer: 13,
	Uint8Array: 14,
	NoValidate: 15
} as const

export type ELYSIA_TYPES = typeof ELYSIA_TYPES

export const primitiveElysiaTypes = new Set([
	ELYSIA_TYPES.Numeric,
	ELYSIA_TYPES.Integer,
	ELYSIA_TYPES.BooleanString,
	ELYSIA_TYPES.Date,
	ELYSIA_TYPES.File,
	ELYSIA_TYPES.Files,
	ELYSIA_TYPES.ArrayBuffer,
	ELYSIA_TYPES.Uint8Array
])

export const noEnumerable = {
	enumerable: false
} as const
