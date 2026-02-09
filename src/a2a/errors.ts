/**
 * A2A Protocol Error Classes
 *
 * Maps A2A-specific errors to both JSON-RPC error codes
 * and HTTP status codes per the specification.
 *
 * @see Section 3.3.2 Error Handling
 * @see Section 5.4 Error Code Mappings
 */

import type { JsonRpcErrorObject } from './types'

// ============================================================================
// JSON-RPC Error Codes
// ============================================================================

/** Standard JSON-RPC 2.0 error codes */
export const JSON_RPC_ERRORS = {
	PARSE_ERROR: -32700,
	INVALID_REQUEST: -32600,
	METHOD_NOT_FOUND: -32601,
	INVALID_PARAMS: -32602,
	INTERNAL_ERROR: -32603
} as const

/** A2A-specific JSON-RPC error codes (-32001 to -32099) */
export const A2A_ERROR_CODES = {
	TASK_NOT_FOUND: -32001,
	TASK_NOT_CANCELABLE: -32002,
	PUSH_NOTIFICATION_NOT_SUPPORTED: -32003,
	UNSUPPORTED_OPERATION: -32004,
	CONTENT_TYPE_NOT_SUPPORTED: -32005,
	INVALID_AGENT_RESPONSE: -32006,
	EXTENDED_AGENT_CARD_NOT_CONFIGURED: -32007,
	EXTENSION_SUPPORT_REQUIRED: -32008,
	VERSION_NOT_SUPPORTED: -32009
} as const

/** HTTP status code mappings for A2A errors */
export const A2A_HTTP_STATUS = {
	TASK_NOT_FOUND: 404,
	TASK_NOT_CANCELABLE: 409,
	PUSH_NOTIFICATION_NOT_SUPPORTED: 400,
	UNSUPPORTED_OPERATION: 400,
	CONTENT_TYPE_NOT_SUPPORTED: 415,
	INVALID_AGENT_RESPONSE: 502,
	EXTENDED_AGENT_CARD_NOT_CONFIGURED: 400,
	EXTENSION_SUPPORT_REQUIRED: 400,
	VERSION_NOT_SUPPORTED: 400
} as const

/** RFC 7807 Problem Details type URIs */
export const A2A_PROBLEM_TYPES = {
	TASK_NOT_FOUND: 'https://a2a-protocol.org/errors/task-not-found',
	TASK_NOT_CANCELABLE: 'https://a2a-protocol.org/errors/task-not-cancelable',
	PUSH_NOTIFICATION_NOT_SUPPORTED:
		'https://a2a-protocol.org/errors/push-notification-not-supported',
	UNSUPPORTED_OPERATION:
		'https://a2a-protocol.org/errors/unsupported-operation',
	CONTENT_TYPE_NOT_SUPPORTED:
		'https://a2a-protocol.org/errors/content-type-not-supported',
	INVALID_AGENT_RESPONSE:
		'https://a2a-protocol.org/errors/invalid-agent-response',
	EXTENDED_AGENT_CARD_NOT_CONFIGURED:
		'https://a2a-protocol.org/errors/extended-agent-card-not-configured',
	EXTENSION_SUPPORT_REQUIRED:
		'https://a2a-protocol.org/errors/extension-support-required',
	VERSION_NOT_SUPPORTED:
		'https://a2a-protocol.org/errors/version-not-supported'
} as const

// ============================================================================
// Base Error Class
// ============================================================================

/**
 * Base class for all A2A protocol errors.
 * Supports both JSON-RPC and HTTP+JSON/REST error representations.
 */
export class A2AError extends Error {
	/** JSON-RPC error code */
	readonly code: number
	/** HTTP status code */
	readonly httpStatus: number
	/** RFC 7807 problem type URI */
	readonly problemType: string
	/** Additional error data/context */
	readonly data?: Record<string, unknown>

	constructor(
		message: string,
		code: number,
		httpStatus: number,
		problemType: string,
		data?: Record<string, unknown>
	) {
		super(message)
		this.name = 'A2AError'
		this.code = code
		this.httpStatus = httpStatus
		this.problemType = problemType
		this.data = data
	}

	/**
	 * Convert to JSON-RPC 2.0 error object
	 */
	toJsonRpcError(): JsonRpcErrorObject {
		return {
			code: this.code,
			message: this.message,
			...(this.data && { data: this.data })
		}
	}

	/**
	 * Convert to RFC 7807 Problem Details response
	 */
	toProblemDetails(): Record<string, unknown> {
		return {
			type: this.problemType,
			title: this.name.replace('Error', '').replace(/([A-Z])/g, ' $1').trim(),
			status: this.httpStatus,
			detail: this.message,
			...(this.data || {})
		}
	}

	/**
	 * Convert to an HTTP Response with Problem Details
	 */
	toResponse(): Response {
		return new Response(JSON.stringify(this.toProblemDetails()), {
			status: this.httpStatus,
			headers: { 'Content-Type': 'application/problem+json' }
		})
	}
}

// ============================================================================
// A2A-Specific Error Classes
// ============================================================================

export class TaskNotFoundError extends A2AError {
	constructor(taskId: string) {
		super(
			`Task '${taskId}' not found`,
			A2A_ERROR_CODES.TASK_NOT_FOUND,
			A2A_HTTP_STATUS.TASK_NOT_FOUND,
			A2A_PROBLEM_TYPES.TASK_NOT_FOUND,
			{ taskId, timestamp: new Date().toISOString() }
		)
		this.name = 'TaskNotFoundError'
	}
}

export class TaskNotCancelableError extends A2AError {
	constructor(taskId: string) {
		super(
			`Task '${taskId}' cannot be canceled`,
			A2A_ERROR_CODES.TASK_NOT_CANCELABLE,
			A2A_HTTP_STATUS.TASK_NOT_CANCELABLE,
			A2A_PROBLEM_TYPES.TASK_NOT_CANCELABLE,
			{ taskId, timestamp: new Date().toISOString() }
		)
		this.name = 'TaskNotCancelableError'
	}
}

export class PushNotificationNotSupportedError extends A2AError {
	constructor() {
		super(
			'Push notifications are not supported by this agent',
			A2A_ERROR_CODES.PUSH_NOTIFICATION_NOT_SUPPORTED,
			A2A_HTTP_STATUS.PUSH_NOTIFICATION_NOT_SUPPORTED,
			A2A_PROBLEM_TYPES.PUSH_NOTIFICATION_NOT_SUPPORTED
		)
		this.name = 'PushNotificationNotSupportedError'
	}
}

export class UnsupportedOperationError extends A2AError {
	constructor(detail?: string) {
		super(
			detail || 'The requested operation is not supported',
			A2A_ERROR_CODES.UNSUPPORTED_OPERATION,
			A2A_HTTP_STATUS.UNSUPPORTED_OPERATION,
			A2A_PROBLEM_TYPES.UNSUPPORTED_OPERATION
		)
		this.name = 'UnsupportedOperationError'
	}
}

export class ContentTypeNotSupportedError extends A2AError {
	constructor(mediaType: string) {
		super(
			`Content type '${mediaType}' is not supported`,
			A2A_ERROR_CODES.CONTENT_TYPE_NOT_SUPPORTED,
			A2A_HTTP_STATUS.CONTENT_TYPE_NOT_SUPPORTED,
			A2A_PROBLEM_TYPES.CONTENT_TYPE_NOT_SUPPORTED,
			{ mediaType }
		)
		this.name = 'ContentTypeNotSupportedError'
	}
}

export class InvalidAgentResponseError extends A2AError {
	constructor(detail?: string) {
		super(
			detail || 'Agent returned an invalid response',
			A2A_ERROR_CODES.INVALID_AGENT_RESPONSE,
			A2A_HTTP_STATUS.INVALID_AGENT_RESPONSE,
			A2A_PROBLEM_TYPES.INVALID_AGENT_RESPONSE
		)
		this.name = 'InvalidAgentResponseError'
	}
}

export class ExtendedAgentCardNotConfiguredError extends A2AError {
	constructor() {
		super(
			'Extended agent card is not configured',
			A2A_ERROR_CODES.EXTENDED_AGENT_CARD_NOT_CONFIGURED,
			A2A_HTTP_STATUS.EXTENDED_AGENT_CARD_NOT_CONFIGURED,
			A2A_PROBLEM_TYPES.EXTENDED_AGENT_CARD_NOT_CONFIGURED
		)
		this.name = 'ExtendedAgentCardNotConfiguredError'
	}
}

export class VersionNotSupportedError extends A2AError {
	constructor(version: string) {
		super(
			`A2A protocol version '${version}' is not supported`,
			A2A_ERROR_CODES.VERSION_NOT_SUPPORTED,
			A2A_HTTP_STATUS.VERSION_NOT_SUPPORTED,
			A2A_PROBLEM_TYPES.VERSION_NOT_SUPPORTED,
			{ requestedVersion: version, supportedVersions: ['1.0'] }
		)
		this.name = 'VersionNotSupportedError'
	}
}

// ============================================================================
// Standard JSON-RPC Error helpers
// ============================================================================

export class JsonRpcParseError extends A2AError {
	constructor() {
		super(
			'Invalid JSON payload',
			JSON_RPC_ERRORS.PARSE_ERROR,
			400,
			'about:blank'
		)
		this.name = 'JsonRpcParseError'
	}
}

export class JsonRpcInvalidRequestError extends A2AError {
	constructor(detail?: string) {
		super(
			detail || 'Request payload validation error',
			JSON_RPC_ERRORS.INVALID_REQUEST,
			400,
			'about:blank'
		)
		this.name = 'JsonRpcInvalidRequestError'
	}
}

export class JsonRpcMethodNotFoundError extends A2AError {
	constructor(method: string) {
		super(
			`Method '${method}' not found`,
			JSON_RPC_ERRORS.METHOD_NOT_FOUND,
			404,
			'about:blank',
			{ method }
		)
		this.name = 'JsonRpcMethodNotFoundError'
	}
}

export class JsonRpcInvalidParamsError extends A2AError {
	constructor(detail?: string) {
		super(
			detail || 'Invalid parameters',
			JSON_RPC_ERRORS.INVALID_PARAMS,
			400,
			'about:blank'
		)
		this.name = 'JsonRpcInvalidParamsError'
	}
}

export class JsonRpcInternalError extends A2AError {
	constructor(detail?: string) {
		super(
			detail || 'Internal error',
			JSON_RPC_ERRORS.INTERNAL_ERROR,
			500,
			'about:blank'
		)
		this.name = 'JsonRpcInternalError'
	}
}
