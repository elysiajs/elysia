import { Elysia } from './base'

export { redirect, sse, form } from './utils'
export {
	status,
	ElysiaError,
	ElysiaStatus,
	NotFound,
	ParseError,
	InternalServerError,
	InvalidCookieSignature,
	ValidationError,
	validationDetail
} from './error'
export {
	t,
	System,
	fileType,
	setFileTypeDetector,
	type FileTypeDetector
} from './type'
export { Compiled } from './compile/aot'
export { file, ElysiaFile } from './universal/file'
export { Cookie, serializeCookie } from './cookie'
export { StatusMap } from './constants'
export { env } from './universal'
// v1 parity: `NotFoundError` was renamed to `NotFound`; keep the old name as an alias.
export { NotFound as NotFoundError } from './error'

export {
	type Context,
	type ErrorContext,
	createContext,
	createBaseContext
} from './context'

export type {
	BaseSchema,
	AnySchema,
	StandardSchemaV1Like,
	StandardJSONSchemaV1Like
} from './type'

export type { SSEPayload } from './types'

export type {
	TraceEvent,
	TraceStream,
	TraceProcess,
	TraceListener,
	TraceHandler
} from './trace'

export { Elysia }
export default Elysia
