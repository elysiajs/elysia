import * as TypeRegistry from './exports'
import type * as TypeBoxType from 'typebox/type'

type TypeBuilder = Omit<typeof TypeBoxType, keyof typeof TypeRegistry> &
	typeof TypeRegistry

export const t: TypeBuilder = TypeRegistry

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
