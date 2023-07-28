import { Kind, TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { TypeCheck, TypeCompiler } from '@sinclair/typebox/compiler'
import type {
	ElysiaInstance,
	DeepMergeTwoTypes,
	LifeCycleStore,
	LocalHook,
	TypedSchema,
	RegisteredHook
} from './types'

// export const mergeObjectArray = <T>(a: T | T[], b: T | T[]): T[] => [
// 	...(Array.isArray(a) ? a : [a]),
// 	...(Array.isArray(b) ? b : [b])
// ]

export const mergeObjectArray = <T>(a: T | T[], b: T | T[]): T[] => {
	const array = [...(Array.isArray(a) ? a : [a])]
	const checksums = []

	for (const item of array) {
		// @ts-ignore
		if (item.$elysiaChecksum)
			// @ts-ignore
			checksums.push(item.$elysiaChecksum)
	}

	for (const item of Array.isArray(b) ? b : [b]) {
		// @ts-ignore
		if (!checksums.includes(item.$elysiaChecksum)) array.push(item)
	}

	return array
}

export const mergeHook = (
	a: LocalHook<any, any> | LifeCycleStore<any>,
	b: LocalHook<any, any>
): RegisteredHook<any> => {
	return {
		// Merge local hook first
		// @ts-ignore
		body: b?.body ?? a?.body,
		// @ts-ignore
		headers: b?.headers ?? a?.headers,
		// @ts-ignore
		params: b?.params ?? a?.params,
		// @ts-ignore
		query: b?.query ?? a?.query,
		// @ts-ignore
		response: b?.response ?? a?.response,
		onResponse: mergeObjectArray(
			a.onResponse ?? [],
			b?.onResponse ?? []
		) as any,
		detail: mergeDeep(
			// @ts-ignore
			b?.detail ?? {},
			// @ts-ignore
			a?.detail ?? {}
		),
		transform: mergeObjectArray(
			a.transform ?? [],
			b?.transform ?? []
		) as any,
		beforeHandle: mergeObjectArray(
			a.beforeHandle ?? [],
			b?.beforeHandle ?? []
		),
		parse: mergeObjectArray((a.parse as any) ?? [], b?.parse ?? []),
		afterHandle: mergeObjectArray(
			a.afterHandle ?? [],
			b?.afterHandle ?? []
		),
		error: mergeObjectArray(a.error ?? [], b?.error ?? []),
		type: a?.type || b?.type
	}
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

export const getSchemaValidator = (
	s: TSchema | string | undefined,
	{
		models = {},
		additionalProperties = false,
		dynamic = false
	}: {
		models?: Record<string, TSchema>
		additionalProperties?: boolean
		dynamic?: boolean
	}
) => {
	if (!s) return
	if (typeof s === 'string' && !(s in models)) return

	const schema: TSchema = typeof s === 'string' ? models[s] : s

	// @ts-ignore
	if (schema.type === 'object' && 'additionalProperties' in schema === false)
		schema.additionalProperties = additionalProperties

	if (dynamic)
		return {
			schema,
			references: '',
			checkFunc: () => {},
			code: '',
			Check: (value: unknown) => Value.Check(schema, value),
			Errors: (value: unknown) => Value.Errors(schema, value),
			Code: () => ''
		} as unknown as TypeCheck<TSchema>

	return TypeCompiler.Compile(schema)
}

export const getResponseSchemaValidator = (
	s: TypedSchema['response'] | undefined,
	{
		models = {},
		additionalProperties = false,
		dynamic = false
	}: {
		models?: Record<string, TSchema>
		additionalProperties?: boolean
		dynamic?: boolean
	}
): Record<number, TypeCheck<any>> | undefined => {
	if (!s) return
	if (typeof s === 'string' && !(s in models)) return

	const maybeSchemaOrRecord = typeof s === 'string' ? models[s] : s

	const compile = (schema: TSchema) => {
		if (dynamic)
			return {
				schema,
				references: '',
				checkFunc: () => {},
				code: '',
				Check: (value: unknown) => Value.Check(schema, value),
				Errors: (value: unknown) => Value.Errors(schema, value),
				Code: () => ''
			} as unknown as TypeCheck<TSchema>

		return TypeCompiler.Compile(schema)
	}

	if (Kind in maybeSchemaOrRecord)
		return {
			200: compile(maybeSchemaOrRecord)
		}

	const record: Record<number, TypeCheck<any>> = {}

	Object.keys(maybeSchemaOrRecord).forEach((status): TSchema | undefined => {
		const maybeNameOrSchema = maybeSchemaOrRecord[status]

		if (typeof maybeNameOrSchema === 'string') {
			if (maybeNameOrSchema in models) {
				const schema = models[maybeNameOrSchema]
				schema.type === 'object' &&
					'additionalProperties' in schema === false

				// Inherits model maybe already compiled
				record[+status] = Kind in schema ? compile(schema) : schema
			}

			return undefined
		}

		if (
			maybeNameOrSchema.type === 'object' &&
			'additionalProperties' in maybeNameOrSchema === false
		)
			maybeNameOrSchema.additionalProperties = additionalProperties

		// Inherits model maybe already compiled
		record[+status] =
			Kind in maybeNameOrSchema
				? compile(maybeNameOrSchema)
				: maybeNameOrSchema
	})

	return record
}

// https://stackoverflow.com/a/52171480
export const checksum = (s: string) => {
	let h = 9

	for (let i = 0; i < s.length; ) h = Math.imul(h ^ s.charCodeAt(i++), 9 ** 9)

	return (h = h ^ (h >>> 9))
}

export const mergeLifeCycle = <
	A extends ElysiaInstance,
	B extends ElysiaInstance
>(
	a: LifeCycleStore<A>,
	b: LifeCycleStore<B> | LocalHook<{}, B>,
	checksum?: number
): LifeCycleStore<A & B> => {
	const injectChecksum = <T>(x: T): T => {
		// @ts-ignore
		x.$elysiaChecksum = checksum

		return x
	}

	// if (a.transform.length)
	// 	console.log({
	// 		"A": "A",
	// 		a: a.transform.map((x) => x.$elysiaChecksum),
	// 		b: a.transform.map((x) => x.$elysiaChecksum)
	// 	})

	const basd = {
		start: mergeObjectArray(
			a.start as any,
			('start' in b ? b.start : []).map(injectChecksum) as any
		),
		request: mergeObjectArray(
			a.request as any,
			('request' in b ? b.request : []).map(injectChecksum) as any
		),
		parse: mergeObjectArray(a.parse as any, b.parse as any).map(
			injectChecksum
		),
		transform: mergeObjectArray(
			a.transform as any,
			(b.transform as any).map(injectChecksum)
		),
		beforeHandle: mergeObjectArray(
			a.beforeHandle as any,
			(b.beforeHandle as any).map(injectChecksum)
		),
		afterHandle: mergeObjectArray(
			a.afterHandle as any,
			(b.afterHandle as any).map(injectChecksum)
		),
		onResponse: mergeObjectArray(
			a.onResponse as any,
			(b.onResponse as any).map(injectChecksum)
		),
		error: mergeObjectArray(
			a.error as any,
			(b.error as any).map(injectChecksum)
		),
		stop: mergeObjectArray(
			a.stop as any,
			('stop' in b ? b.stop : ([] as any)).map(injectChecksum)
		)
	}

	// if (a.transform.length)
	// 	console.log({
	// 		summed: basd.transform.map((x) => x.$elysiaChecksum)
	// 	})

	return basd
}
