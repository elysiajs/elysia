import { Kind, TSchema } from '@sinclair/typebox'
import type { OpenAPIV2 } from 'openapi-types'

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
		in: name,
		name: key,
		// @ts-ignore
		type: value?.type,
		// @ts-ignore
		required: schema!.required?.includes(key) ?? false
	}))
}

export const registerSchemaPath = ({
	schema,
	path,
	method,
	hook,
	models
}: {
	schema: OpenAPIV2.PathsObject
	path: string
	method: HTTPMethod
	hook?: LocalHook
	models: Record<string, TSchema>
}) => {
	path = toOpenAPIPath(path)

	const bodySchema = hook?.schema?.body
	const paramsSchema = hook?.schema?.params
	const headerSchema = hook?.schema?.headers
	const querySchema = hook?.schema?.query
	let responseSchema = hook?.schema?.response

	if (typeof responseSchema === 'object') {
		if (Kind in responseSchema) {
			responseSchema = {
				// @ts-ignore
				'200': {
					schema: responseSchema
				}
			}
		} else {
			Object.entries(responseSchema as Record<string, TSchema>).forEach(
				([key, value]) => {
					if (typeof value === 'string')
						// @ts-ignore
						responseSchema[key] = {
							schema: {
								$ref: `#/definitions/${value}`
							}
						}
				}
			)
		}
	} else if (typeof responseSchema === 'string')
		responseSchema = {
			// @ts-ignore
			'200': {
				schema: {
					$ref: `#/definitions/${responseSchema}`
				}
			}
		}

	const parameters = [
		...mapProperties('header', headerSchema, models),
		...mapProperties('path', paramsSchema, models),
		...mapProperties('query', querySchema, models)
	]

	if (bodySchema)
		parameters.push({
			in: 'body',
			name: 'body',
			required: true,
			// @ts-ignore
			schema:
				typeof bodySchema === 'string'
					? {
							$ref: `#/definitions/${bodySchema}`
					  }
					: bodySchema
		})

	schema[path] = {
		...(schema[path] ? schema[path] : {}),
		[method.toLowerCase()]: {
			...(headerSchema || paramsSchema || querySchema || bodySchema
				? { parameters }
				: {}),
			...(responseSchema
				? {
						responses: responseSchema
				  }
				: {}),
			...hook?.schema?.detail
		}
	}
}
