import { Kind, type TSchema } from '@sinclair/typebox'
import type { OpenAPIV3 } from 'openapi-types'
import deepClone from 'lodash.clonedeep'

import type { HTTPMethod, LocalHook } from './types'

export const toOpenAPIPath = (path: string) =>
	path
		.split('/')
		.map((x) => (x.startsWith(':') ? `{${x.slice(1, x.length)}}` : x))
		.join('/')

export const mapProperties = (
	name: string,
	schema: TSchema | string | undefined,
	models: Record<string, TSchema>
) => {
	if (schema === undefined) return []

	if (typeof schema === 'string')
		if (schema in models) schema = models[schema]
		else throw new Error(`Can't find model ${schema}`)

	return Object.entries(schema?.properties ?? []).map(([key, value]) => ({
		// @ts-ignore
		...value,
		in: name,
		name: key,
		// @ts-ignore
		type: value?.type,
		// @ts-ignore
		required: schema!.required?.includes(key) ?? false
	}))
}

const mapTypesResponse = (
	types: string[],
	schema:
		| string
		| {
				type: string
				properties: Object
				required: string[]
		  }
) => {
	const responses: Record<string, OpenAPIV3.MediaTypeObject> = {}

	for (const type of types)
		responses[type] = {
			schema:
				typeof schema === 'string'
					? {
							$ref: `#/components/schemas/${schema}`
					  }
					: { ...(schema as any) }
		}

	return responses
}

export const registerSchemaPath = ({
	schema,
	contentType = ['application/json', 'multipart/form-data', 'text/plain'],
	path,
	method,
	hook,
	models
}: {
	schema: Partial<OpenAPIV3.PathsObject>
	contentType?: string | string[]
	path: string
	method: HTTPMethod
	hook?: LocalHook
	models: Record<string, TSchema>
}) => {
	if (hook) hook = deepClone(hook)

	path = toOpenAPIPath(path)

	const contentTypes =
		typeof contentType === 'string'
			? [contentType]
			: contentType ?? ['application/json']

	const bodySchema = hook?.schema?.body
	const paramsSchema = hook?.schema?.params
	const headerSchema = hook?.schema?.headers
	const querySchema = hook?.schema?.query
	let responseSchema = hook?.schema
		?.response as unknown as OpenAPIV3.ResponsesObject

	if (typeof responseSchema === 'object') {
		if (Kind in responseSchema) {
			const { type, properties, required, ...rest } =
				responseSchema as typeof responseSchema & {
					type: string
					properties: Object
					required: string[]
				}

			responseSchema = {
				'200': {
					...rest,
					description: rest.description as any,
					content: mapTypesResponse(
						contentTypes,
						type === 'object' || type === 'array'
							? ({
									type,
									properties,
									required
							  } as any)
							: responseSchema
					)
				}
			}
		} else {
			Object.entries(responseSchema as Record<string, TSchema>).forEach(
				([key, value]) => {
					if (typeof value === 'string') {
						// eslint-disable-next-line @typescript-eslint/no-unused-vars
						const { type, properties, required, ...rest } = models[
							value
						] as TSchema & {
							type: string
							properties: Object
							required: string[]
						}

						responseSchema[key] = {
							...rest,
							description: rest.description as any,
							content: mapTypesResponse(contentTypes, value)
						}
					} else {
						const { type, properties, required, ...rest } =
							value as typeof value & {
								type: string
								properties: Object
								required: string[]
							}

						responseSchema[key] = {
							...rest,
							description: rest.description as any,
							content: mapTypesResponse(contentTypes, {
								type,
								properties,
								required
							})
						}
					}
				}
			)
		}
	} else if (typeof responseSchema === 'string') {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { type, properties, required, ...rest } = models[
			responseSchema
		] as TSchema & {
			type: string
			properties: Object
			required: string[]
		}

		responseSchema = {
			// @ts-ignore
			'200': {
				...rest,
				content: mapTypesResponse(contentTypes, responseSchema)
			}
		}
	}

	const parameters = [
		...mapProperties('header', headerSchema, models),
		...mapProperties('path', paramsSchema, models),
		...mapProperties('query', querySchema, models)
	]

	schema[path] = {
		...(schema[path] ? schema[path] : {}),
		[method.toLowerCase()]: {
			...((headerSchema || paramsSchema || querySchema || bodySchema
				? ({ parameters } as any)
				: {}) satisfies OpenAPIV3.ParameterObject),
			...(responseSchema
				? {
						responses: responseSchema
				  }
				: {}),
			...hook?.schema?.detail,
			...(bodySchema
				? {
						requestBody: {
							content: mapTypesResponse(
								contentTypes,
								typeof bodySchema === 'string'
									? {
											$ref: `#/components/schemas/${bodySchema}`
									  }
									: (bodySchema as any)
							)
						}
				  }
				: null)
		} satisfies OpenAPIV3.OperationObject
	}
}
