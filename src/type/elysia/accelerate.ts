import type { StandardJSONSchemaV1Like } from '../types'

export function Accelerate(schema: StandardJSONSchemaV1Like) {
	const raw =
		// @ts-expect-error
		schema.toJSONSchema?.() ??
		// @ts-expect-error
		schema.toJsonSchema?.() ??
		schema['~standard'].jsonSchema.input({
			target: 'draft-2020-12'
		})

	const jsonSchema = Object.isFrozen(raw) ? Object.assign({}, raw) : raw
	jsonSchema['~elyAcl'] = true

	return jsonSchema
}
