/**
 * JSON-RPC 2.0 Handler for A2A Protocol
 *
 * Parses JSON-RPC requests and dispatches to the appropriate
 * A2A operation handler. Supports both standard request/response
 * and SSE streaming for SendStreamingMessage and SubscribeToTask.
 *
 * @see Section 9. JSON-RPC Protocol Binding
 */

import type {
	JsonRpcRequest,
	JsonRpcResponse,
	JsonRpcSuccessResponse,
	JsonRpcErrorResponse,
	SendMessageRequest,
	GetTaskRequest,
	ListTasksRequest,
	CancelTaskRequest,
	SubscribeToTaskRequest,
	CreateTaskPushNotificationConfigRequest,
	GetTaskPushNotificationConfigRequest,
	DeleteTaskPushNotificationConfigRequest,
	StreamResponse
} from './types'

import {
	A2AError,
	JsonRpcParseError,
	JsonRpcInvalidRequestError,
	JsonRpcMethodNotFoundError,
	JsonRpcInvalidParamsError,
	JsonRpcInternalError
} from './errors'

/**
 * A2A JSON-RPC method names (PascalCase per spec)
 */
export const A2A_METHODS = {
	SEND_MESSAGE: 'SendMessage',
	SEND_STREAMING_MESSAGE: 'SendStreamingMessage',
	GET_TASK: 'GetTask',
	LIST_TASKS: 'ListTasks',
	CANCEL_TASK: 'CancelTask',
	SUBSCRIBE_TO_TASK: 'SubscribeToTask',
	CREATE_PUSH_CONFIG: 'CreateTaskPushNotificationConfig',
	GET_PUSH_CONFIG: 'GetTaskPushNotificationConfig',
	LIST_PUSH_CONFIGS: 'ListTaskPushNotificationConfig',
	DELETE_PUSH_CONFIG: 'DeleteTaskPushNotificationConfig',
	GET_EXTENDED_AGENT_CARD: 'GetExtendedAgentCard'
} as const

/** Methods that return SSE streams instead of JSON */
export const STREAMING_METHODS: Set<string> = new Set([
	A2A_METHODS.SEND_STREAMING_MESSAGE,
	A2A_METHODS.SUBSCRIBE_TO_TASK
])

/**
 * Parse and validate a JSON-RPC 2.0 request
 */
export function parseJsonRpcRequest(body: unknown): JsonRpcRequest {
	if (!body || typeof body !== 'object') {
		throw new JsonRpcInvalidRequestError('Request body must be a JSON object')
	}

	const req = body as Record<string, unknown>

	if (req.jsonrpc !== '2.0') {
		throw new JsonRpcInvalidRequestError(
			'Missing or invalid "jsonrpc" field. Must be "2.0"'
		)
	}

	if (req.id === undefined || req.id === null) {
		throw new JsonRpcInvalidRequestError('Missing "id" field')
	}

	if (typeof req.id !== 'string' && typeof req.id !== 'number') {
		throw new JsonRpcInvalidRequestError(
			'"id" must be a string or number'
		)
	}

	if (typeof req.method !== 'string') {
		throw new JsonRpcInvalidRequestError(
			'Missing or invalid "method" field'
		)
	}

	if (req.params !== undefined && typeof req.params !== 'object') {
		throw new JsonRpcInvalidParamsError('"params" must be an object')
	}

	return {
		jsonrpc: '2.0',
		id: req.id as string | number,
		method: req.method,
		params: req.params as Record<string, unknown> | undefined
	}
}

/**
 * Create a JSON-RPC 2.0 success response
 */
export function jsonRpcSuccess(
	id: string | number,
	result: unknown
): JsonRpcSuccessResponse {
	return {
		jsonrpc: '2.0',
		id,
		result
	}
}

/**
 * Create a JSON-RPC 2.0 error response
 */
export function jsonRpcError(
	id: string | number | null,
	error: A2AError
): JsonRpcErrorResponse {
	return {
		jsonrpc: '2.0',
		id,
		error: error.toJsonRpcError()
	}
}

/**
 * Create an SSE-formatted data line for streaming
 */
export function sseEvent(data: unknown): string {
	return `data: ${JSON.stringify(data)}\n\n`
}

/**
 * Create an SSE stream response wrapping a JSON-RPC result
 */
export function sseJsonRpcEvent(
	id: string | number,
	result: StreamResponse
): string {
	return sseEvent(jsonRpcSuccess(id, result))
}

/**
 * Validate SendMessageRequest params
 */
export function validateSendMessageParams(
	params: Record<string, unknown> | undefined
): SendMessageRequest {
	if (!params) {
		throw new JsonRpcInvalidParamsError(
			'SendMessage requires "params" with a "message" field'
		)
	}

	const message = params.message
	if (!message || typeof message !== 'object') {
		throw new JsonRpcInvalidParamsError(
			'SendMessage requires a "message" object in params'
		)
	}

	const msg = message as Record<string, unknown>
	if (!msg.messageId || typeof msg.messageId !== 'string') {
		throw new JsonRpcInvalidParamsError(
			'Message must have a "messageId" string'
		)
	}

	if (!msg.role || typeof msg.role !== 'string') {
		throw new JsonRpcInvalidParamsError('Message must have a "role" field')
	}

	if (!Array.isArray(msg.parts) || msg.parts.length === 0) {
		throw new JsonRpcInvalidParamsError(
			'Message must have at least one part in "parts"'
		)
	}

	return params as unknown as SendMessageRequest
}

/**
 * Validate GetTask params
 */
export function validateGetTaskParams(
	params: Record<string, unknown> | undefined
): GetTaskRequest {
	if (!params || !params.id || typeof params.id !== 'string') {
		throw new JsonRpcInvalidParamsError(
			'GetTask requires "id" (string) in params'
		)
	}
	return params as unknown as GetTaskRequest
}

/**
 * Validate ListTasks params
 */
export function validateListTasksParams(
	params: Record<string, unknown> | undefined
): ListTasksRequest {
	// ListTasks params are all optional
	return (params || {}) as ListTasksRequest
}

/**
 * Validate CancelTask params
 */
export function validateCancelTaskParams(
	params: Record<string, unknown> | undefined
): CancelTaskRequest {
	if (!params || !params.id || typeof params.id !== 'string') {
		throw new JsonRpcInvalidParamsError(
			'CancelTask requires "id" (string) in params'
		)
	}
	return params as unknown as CancelTaskRequest
}

/**
 * Validate SubscribeToTask params
 */
export function validateSubscribeToTaskParams(
	params: Record<string, unknown> | undefined
): SubscribeToTaskRequest {
	if (!params || !params.id || typeof params.id !== 'string') {
		throw new JsonRpcInvalidParamsError(
			'SubscribeToTask requires "id" (string) in params'
		)
	}
	return params as unknown as SubscribeToTaskRequest
}

/**
 * Validate CreateTaskPushNotificationConfig params
 */
export function validateCreatePushConfigParams(
	params: Record<string, unknown> | undefined
): CreateTaskPushNotificationConfigRequest {
	if (!params) {
		throw new JsonRpcInvalidParamsError(
			'CreateTaskPushNotificationConfig requires params'
		)
	}
	if (!params.taskId || typeof params.taskId !== 'string') {
		throw new JsonRpcInvalidParamsError('Requires "taskId" string')
	}
	if (!params.configId || typeof params.configId !== 'string') {
		throw new JsonRpcInvalidParamsError('Requires "configId" string')
	}
	if (!params.config || typeof params.config !== 'object') {
		throw new JsonRpcInvalidParamsError('Requires "config" object')
	}
	return params as unknown as CreateTaskPushNotificationConfigRequest
}

/**
 * Validate GetTaskPushNotificationConfig params
 */
export function validateGetPushConfigParams(
	params: Record<string, unknown> | undefined
): GetTaskPushNotificationConfigRequest {
	if (!params) {
		throw new JsonRpcInvalidParamsError('Requires params')
	}
	if (!params.taskId || typeof params.taskId !== 'string') {
		throw new JsonRpcInvalidParamsError('Requires "taskId" string')
	}
	if (!params.id || typeof params.id !== 'string') {
		throw new JsonRpcInvalidParamsError('Requires "id" string')
	}
	return params as unknown as GetTaskPushNotificationConfigRequest
}

/**
 * Validate DeleteTaskPushNotificationConfig params
 */
export function validateDeletePushConfigParams(
	params: Record<string, unknown> | undefined
): DeleteTaskPushNotificationConfigRequest {
	if (!params) {
		throw new JsonRpcInvalidParamsError('Requires params')
	}
	if (!params.taskId || typeof params.taskId !== 'string') {
		throw new JsonRpcInvalidParamsError('Requires "taskId" string')
	}
	if (!params.id || typeof params.id !== 'string') {
		throw new JsonRpcInvalidParamsError('Requires "id" string')
	}
	return params as unknown as DeleteTaskPushNotificationConfigRequest
}
