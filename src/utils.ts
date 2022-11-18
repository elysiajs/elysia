import KingWorldError from './error'

import { TypeCheck, TypeCompiler, type ValueError } from '@sinclair/typebox/compiler'
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
						header: bSchema?.header ?? aSchema?.header,
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

// export const isPromise = <T>(
// 	response: T | Promise<T>
// ): response is Promise<T> => response instanceof Promise

export const clone = <T extends Object | any[] = Object | any[]>(value: T): T =>
	[value][0]

// export const splitOnce = (char: string, s: string) => {
// 	const i = s.indexOf(char)

// 	return i === -1 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)]
// }

export const getPath = (url: string): string => {
	const queryIndex = url.indexOf('?')
	const result = url.substring(
		url.charCodeAt(0) === 47 ? 0 : url.indexOf('/', 11),
		queryIndex === -1 ? url.length : queryIndex
	)

	return result
}

export const mapQuery = (url: string): Record<string, string> => {
	const queryIndex = url.indexOf('?')
	if (queryIndex === -1) return {}

	return url
		.substring(queryIndex + 1)
		.split('&')
		.reduce((result, each) => {
			const i = each.indexOf('=')
			result[each.slice(0, i)] = each.slice(i + 1)

			return result
		}, {} as Record<string, string>)
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

	return new KingWorldError(
		'VALIDATION',
		`Invalid ${type}, ${error?.path?.slice(1) || 'root'}: ${error.message}`
	)
}

export const getSchemaValidator = (
	schema: TSchema | undefined,
	additionalProperties = false
) => {
	if (!schema) return

	if (schema.type === 'object' && !('additionalProperties' in schema))
		schema.additionalProperties = additionalProperties

	return TypeCompiler.Compile(schema)
}
