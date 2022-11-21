import type { TSchema } from '@sinclair/typebox'

import type { HTTPMethod, LocalHook } from './types'

export const toOpenAPIPath = (path: string) =>
	path
		.split('/')
		.map((x) => (x.startsWith(':') ? `{${x.slice(1, x.length)}}` : x))
		.join('/')

export const mapProperties = (name: string, schema: TSchema | undefined) =>
	Object.entries(schema?.properties ?? []).map(([key, value]) => ({
		in: name,
		name: key,
		// @ts-ignore
		type: value?.type,
		required: schema!.required?.includes(key) ?? false
	}))

export const registerSchemaPath = ({
	schema,
	path,
	method,
	hook
}: {
	schema: Record<string, Object>
	path: string
	method: HTTPMethod
	hook?: LocalHook<any>
}) => {
	path = toOpenAPIPath(path)

	const bodySchema = hook?.schema?.body
	const paramsSchema = hook?.schema?.params
	const headerSchema = hook?.schema?.header
	const querySchema = hook?.schema?.query
	const responseSchema = hook?.schema?.response

	const parameters = [
		...mapProperties('header', headerSchema),
		...mapProperties('path', paramsSchema),
		...mapProperties('query', querySchema)
	]

	if (bodySchema)
		parameters.push({
			in: 'body',
			name: 'body',
			required: true,
			// @ts-ignore
			schema: bodySchema
		})

	schema[path] = {
		...(schema[path] ? schema[path] : {}),
		[method.toLowerCase()]: {
			...(headerSchema || paramsSchema || querySchema || bodySchema
				? { parameters }
				: {}),
			...(responseSchema
				? {
						responses: {
							'200': {
								description: 'Default response',
								schema: responseSchema
							}
						}
				  }
				: {})
		}
	}
}
