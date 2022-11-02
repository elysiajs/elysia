import type { ZodSchema } from 'zod'
import zodToJsonSchema from 'zod-to-json-schema'
import type { JsonSchema7ObjectType } from 'zod-to-json-schema/src/parsers/object'

import type { HTTPMethod, LocalHook } from './types'

const getSchema = (
	schema: ZodSchema | undefined
): JsonSchema7ObjectType | undefined => {
	if (!schema) return

	return zodToJsonSchema(schema) as unknown as JsonSchema7ObjectType
}

const replace = (word: string, find: string, replacer: string, startAt = 0) => {
	const index = word.indexOf(find, startAt)

	if (index > word.length - 1 || index === -1) return word
	return word.substring(0, index) + replacer + word.substring(index + 1)
}

const toOpenAPIPath = (path: string) => {
	while (path.includes(':')) {
		path = replace(path, ':', '{')
		const index = path.indexOf('{')

		path = replace(path, '/', '}/', index)
		if (path.indexOf('/', index)) path += '}'
	}

	return path
}

const mapProperties = (
	name: string,
	schema: JsonSchema7ObjectType | undefined
) =>
	Object.entries(schema?.properties ?? []).map(([key, value]) => ({
		in: name,
		name: key,
		// @ts-ignore
		type: value.type,
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

	const bodySchema = getSchema(hook?.schema?.body)
	const paramsSchema = getSchema(hook?.schema?.params)
	const headerSchema = getSchema(hook?.schema?.header)
	const querySchema = getSchema(hook?.schema?.query)
	const responseSchema = getSchema(hook?.schema?.response)

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
		[method]: {
			...(headerSchema || paramsSchema || querySchema || bodySchema
				? { parameters }
				: {}),
			...(responseSchema
				? {
						response: {
							'200': responseSchema
						}
				  }
				: {})
		}
	}
}
