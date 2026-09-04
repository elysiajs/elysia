import { Elysia, type AnyElysia } from './base'

export { redirect, sse, bytes, form, prefix } from './utils'
export { borrow } from './adapter/response-ownership'
export {
	status,
	problem,
	type Problem,
	ElysiaError,
	ElysiaStatus,
	NotFound,
	ParseError,
	InternalServerError,
	ValidationError,
	validationDetail,
	type StatusResponse,
	type NumericStatus,
	type ValidationErrorResponse,
	HTTPError,
	type TaggedHTTPError,
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
export {
	Capture as Manifest,
	Compiled,
	type AotFingerprint,
	type CompilerSession,
	type ProgramId
} from './compile/aot'
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

export type {
	HTTPHeaders,
	SSEPayload,
	UnwrapSchema,
	DefaultEphemeral,
	DefaultMetadata,
	DefaultSingleton,
	RouteSchema,
	InputSchema,
	UnwrapRoute,
	Macro,
	MacroToProperty,
	MacroToContext,
	MacroTypeLambda
} from './types'
export type { Cookie } from './cookie/cookie'
export { InvalidCookie } from './cookie/error'
export type { BaseCookie, CookieOptions } from './cookie/types'
export type { Server } from './universal/server'
export type { TCookieObject, TCookieField } from './type/elysia/cookie'
export type { TFiles } from './type/elysia/files'

export { Elysia, AnyElysia }
export default Elysia
