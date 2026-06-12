import type * as Type from './exports'

import { setupTypebox } from './compat'
import { ensureTypeRegistry, setSetupTrigger } from './bridge'

setSetupTrigger(setupTypebox)

export let t: typeof Type = new Proxy({} as typeof Type, {
	get(_, prop) {
		setupTypebox()

		t = ensureTypeRegistry() as typeof Type

		return t[prop as keyof typeof Type]
	},
	has(_, prop) {
		setupTypebox()

		return prop in ensureTypeRegistry()
	},
	ownKeys() {
		setupTypebox()

		return Reflect.ownKeys(ensureTypeRegistry())
	},
	getOwnPropertyDescriptor(_, prop) {
		setupTypebox()

		const descriptor = Reflect.getOwnPropertyDescriptor(
			ensureTypeRegistry(),
			prop
		)
		// The proxy target doesn't own `prop`, so the descriptor must be
		// reported configurable (module namespace props are not)
		if (descriptor) descriptor.configurable = true

		return descriptor
	}
})

export { System } from 'typebox/system'
export {
	fileType,
	setFileTypeDetector,
	type FileTypeDetector
} from './elysia/file-type'
export type {
	BaseSchema,
	AnySchema,
	TypeBoxSchema,
	StandardSchemaV1Like,
	StandardJSONSchemaV1Like
} from './types'
