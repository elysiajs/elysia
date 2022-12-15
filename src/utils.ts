import {
	TypeCheck,
	TypeCompiler,
	type ValueError
} from '@sinclair/typebox/compiler'
import type { TSchema } from '@sinclair/typebox'
import type {
	DeepMergeTwoTypes,
	LifeCycleStore,
	LocalHook,
	TypedSchema
} from './types'

export const SCHEMA: unique symbol = Symbol('schema')

export const mergeObjectArray = <T>(a: T | T[], b: T | T[]): T[] => [
	...(Array.isArray(a) ? a : [a]),
	...(Array.isArray(b) ? b : [b])
]

export const mergeHook = (
	a: LocalHook<any> | LifeCycleStore<any>,
	b: LocalHook<any>
): LocalHook<any, any> => {
	const aSchema = 'schema' in a ? (a.schema as TypedSchema) : null
	const bSchema = b && 'schema' in b ? b.schema : null

	return {
		schema:
			aSchema || bSchema
				? ({
						// Merge local hook first
						body: bSchema?.body ?? aSchema?.body,
						header: bSchema?.headers ?? aSchema?.headers,
						params: bSchema?.params ?? aSchema?.params,
						query: bSchema?.query ?? aSchema?.query,
						response: bSchema?.response ?? aSchema?.response
				  } as TypedSchema)
				: null,
		transform: mergeObjectArray(a.transform ?? [], b?.transform ?? []),
		beforeHandle: mergeObjectArray(
			a.beforeHandle ?? [],
			b?.beforeHandle ?? []
		),
		afterHandle: mergeObjectArray(
			a.afterHandle ?? [],
			b?.afterHandle ?? []
		),
		error: mergeObjectArray(a.error ?? [], b?.error ?? [])
	}
}

export const clone = <T extends Object | any[] = Object | any[]>(value: T): T =>
	[value][0]

export const getPath = (url: string, queryIndex: number): string =>
	url.substring(
		url.charCodeAt(0) === 47 ? 0 : url.indexOf('/', 11),
		queryIndex === -1 ? url.length : queryIndex
	)

export const mapQuery = (
	url: string,
	queryIndex: number
): Record<string, string> => {
	if (queryIndex === -1) return {}

	const query: Record<string, string> = {}
	let paths = url.slice(queryIndex)

	// eslint-disable-next-line no-constant-condition
	while (true) {
		// Skip ?/&, and min length of query is 3, so start looking at 1 + 3
		const sep = paths.indexOf('&', 4)
		if (sep === -1) {
			const equal = paths.indexOf('=', 1)
			query[paths.slice(1, equal)] = paths.slice(equal + 1)

			break
		}

		const path = paths.slice(0, sep)
		const equal = path.indexOf('=')
		query[path.slice(1, equal)] = path.slice(equal + 1)

		paths = paths.slice(sep)
	}

	return query
}

const isObject = (item: any): item is Object =>
	item && typeof item === 'object' && !Array.isArray(item)

// https://stackoverflow.com/a/37164538
export const mergeDeep = <A extends Object = Object, B extends Object = Object>(
	target: A,
	source: B
): DeepMergeTwoTypes<A, B> => {
	const output: Partial<DeepMergeTwoTypes<A, B>> = Object.assign({}, target)
	if (isObject(target) && isObject(source)) {
		Object.keys(source).forEach((key) => {
			// @ts-ignore
			if (isObject(source[key])) {
				if (!(key in target))
					// @ts-ignore
					Object.assign(output, { [key]: source[key] })
				// @ts-ignore
				else output[key] = mergeDeep(target[key], source[key])
			} else {
				// @ts-ignore
				Object.assign(output, { [key]: source[key] })
			}
		})
	}

	return output as DeepMergeTwoTypes<A, B>
}

export const createValidationError = (
	type: string,
	validator: TypeCheck<any>,
	value: any
) => {
	const error = validator.Errors(value).next().value as ValueError

	return new Error('VALIDATION', {
		cause: `Invalid ${type}: '${error?.path?.slice(1) || 'root'}'. ${
			error.message
		}`
	})
}

export const getSchemaValidator = <
	Schema extends TSchema | undefined = undefined
>(
	schema: Schema,
	additionalProperties = false
) => {
	if (!schema) return

	// @ts-ignore
	if (schema.type === 'object' && 'additionalProperties' in schema === false)
		schema.additionalProperties = additionalProperties

	return TypeCompiler.Compile(schema)
}
