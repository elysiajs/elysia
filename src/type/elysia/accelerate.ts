import type { StandardJSONSchemaV1Like } from '../types'

export function Accelerate(schema: StandardJSONSchemaV1Like) {
	const jsonSchema =
		// @ts-expect-error
		schema.toJSONSchema?.() ??
		// @ts-expect-error
		schema.toJsonSchema?.() ??
		schema['~standard'].jsonSchema.input({
			target: 'draft-2020-12'
		})

	jsonSchema['~elyAcl'] = true

	return jsonSchema
}
