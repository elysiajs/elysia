import * as Type from './exports'
import { setupTypebox } from './compat'

export let t: typeof Type = new Proxy(Type, {
	get(target, prop) {
		setupTypebox()

		t = Type

		return target[prop as keyof typeof target]
	}
})

export { System } from 'typebox/system'
export {
	fileType,
	setFileTypeDetector,
	type FileTypeDetector
} from './elysia/file'
export type {
	BaseSchema,
	AnySchema,
	TypeBoxSchema,
	StandardSchemaV1Like,
	StandardJSONSchemaV1Like
} from './types'
