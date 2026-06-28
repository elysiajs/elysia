import * as TypeRegistry from './exports'

export const t: typeof TypeRegistry = TypeRegistry

export { setupTypebox } from './compat'
export { System as TypeSystem } from 'typebox/system'
export {
	fileType,
	setFileTypeDetector,
	type FileTypeDetector
} from './elysia/file-type'
export { TypeBoxValidator } from './validator'
export type {
	BaseSchema,
	AnySchema,
	TypeBoxSchema,
	StandardSchemaV1Like,
	StandardJSONSchemaV1Like
} from './types'
