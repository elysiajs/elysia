import { Elysia } from './base'

export { redirect, sse, form, prefix } from './utils'
export {
	status,
	ElysiaError,
	ElysiaStatus,
	NotFound,
	ParseError,
	InternalServerError,
	InvalidCookieSignature,
	ValidationError,
	validationDetail,
	type SelectiveStatus
} from './error'
export {
	t,
	setupTypebox,
	fileType,
	setFileTypeDetector,
	TypeBoxValidator,
	TypeSystem,
	type FileTypeDetector
} from './type'
export { Capture as Manifest, Compiled } from './compile/aot'
export { file, ElysiaFile } from './universal/file'
export { StatusMap, StatusMapBack } from './constants'
export { Validator, StandardValidator, MultiValidator } from './validator'
export { env } from './universal'

export {
	type Context,
	type ErrorContext,
	createContext,
	createBaseContext
} from './context'

export type {
	AnySchema,
	BaseSchema,
	StandardSchemaV1Like,
	StandardJSONSchemaV1Like
} from './type'

export type { HTTPHeaders, SSEPayload, UnwrapSchema } from './types'
export type {
	RouteSchema,
	InputSchema,
	UnwrapRoute,
	Macro,
	MacroToProperty,
	MacroToContext
} from './types'
export type { Cookie } from './cookie/cookie'
export type { BaseCookie, CookieOptions } from './cookie/types'
export type { Server } from './universal/server'
export type { TCookieObject, TCookieField } from './type/elysia/cookie'
export type { TFiles } from './type/elysia/files'

export { Elysia }
export default Elysia
