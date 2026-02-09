/**
 * A2A Protocol Plugin for ElysiaJS
 *
 * Implements the Agent-to-Agent (A2A) Protocol with both
 * JSON-RPC 2.0 and HTTP+JSON/REST protocol bindings.
 *
 * Features:
 * - Agent Card discovery at /.well-known/agent-card.json
 * - JSON-RPC 2.0 endpoint (single POST endpoint)
 * - HTTP+JSON/REST endpoints (RESTful routes)
 * - SSE streaming for real-time task updates
 * - Pluggable task store (in-memory default)
 * - Push notification support
 * - Full A2A RC v1.0 compliance
 *
 * @see https://a2a-protocol.org/latest/specification/
 *
 * @example
 * ```typescript
 * import { Elysia } from 'elysia'
 * import { a2a } from './a2a'
 *
 * const app = new Elysia()
 *   .use(a2a({
 *     agent: {
 *       name: 'My Agent',
 *       description: 'A helpful assistant',
 *       version: '1.0.0',
 *       skills: [{
 *         id: 'chat',
 *         name: 'Chat',
 *         description: 'General conversation',
 *         tags: ['chat']
 *       }]
 *     },
 *     async onMessage({ message }) {
 *       return {
 *         artifacts: [{
 *           artifactId: crypto.randomUUID(),
 *           parts: [{ text: 'Hello!' }]
 *         }]
 *       }
 *     }
 *   }))
 *   .listen(3000)
 * ```
 */

import { Elysia } from '../index'
import { InMemoryTaskStore } from './task-store'
import {
	parseJsonRpcRequest,
	jsonRpcSuccess,
	jsonRpcError,
	sseEvent,
	A2A_METHODS,
	STREAMING_METHODS,
	validateSendMessageParams,
	validateGetTaskParams,
	validateListTasksParams,
	validateCancelTaskParams,
	validateSubscribeToTaskParams,
	validateCreatePushConfigParams,
	validateGetPushConfigParams,
	validateDeletePushConfigParams
} from './json-rpc'
import {
	A2AError,
	TaskNotFoundError,
	TaskNotCancelableError,
	PushNotificationNotSupportedError,
	UnsupportedOperationError,
	JsonRpcInternalError,
	JsonRpcMethodNotFoundError,
	JsonRpcParseError
} from './errors'
import type {
	A2APluginOptions,
	A2AHandlerContext,
	AgentCard,
	AgentInterface,
	Task,
	TaskStore,
	Message,
	Artifact,
	TaskState,
	StreamResponse,
	SendMessageRequest,
	A2AStreamEvent
} from './types'

const A2A_PROTOCOL_VERSION = '1.0'
const A2A_CONTENT_TYPE = 'application/json'

/**
 * Generate a UUID v4
 */
function generateId(): string {
	return crypto.randomUUID()
}

/**
 * Get current ISO 8601 timestamp
 */
function now(): string {
	return new Date().toISOString()
}

/**
 * Create a new Task object
 */
function createTask(
	contextId?: string,
	metadata?: Record<string, unknown>
): Task {
	return {
		id: generateId(),
		contextId: contextId || generateId(),
		status: {
			state: 'TASK_STATE_SUBMITTED',
			timestamp: now()
		},
		artifacts: [],
		history: [],
		metadata
	}
}

/**
 * Trim task history to the requested length
 */
function trimHistory(task: Task, historyLength?: number): Task {
	if (historyLength === undefined) return task
	if (historyLength === 0) {
		const { history, ...rest } = task
		return rest as Task
	}
	if (task.history && task.history.length > historyLength) {
		return {
			...task,
			history: task.history.slice(-historyLength)
		}
	}
	return task
}

/**
 * Remove artifacts from task if not requested
 */
function stripArtifacts(task: Task, includeArtifacts: boolean): Task {
	if (!includeArtifacts) {
		const { artifacts, ...rest } = task
		return rest as Task
	}
	return task
}

/**
 * Build the Agent Card from plugin options
 */
function buildAgentCard(
	options: A2APluginOptions,
	baseUrl: string
): AgentCard {
	const basePath = options.basePath || ''
	const jsonRpcUrl = `${baseUrl}${basePath}/a2a`
	const restUrl = `${baseUrl}${basePath}`

	const interfaces: AgentInterface[] = [
		{
			url: jsonRpcUrl,
			protocolBinding: 'JSONRPC',
			protocolVersion: A2A_PROTOCOL_VERSION
		},
		{
			url: restUrl,
			protocolBinding: 'HTTP+JSON',
			protocolVersion: A2A_PROTOCOL_VERSION
		}
	]

	const hasStreaming =
		options.capabilities?.streaming ?? !!options.onStreamMessage
	const hasPushNotifications =
		options.capabilities?.pushNotifications ?? false
	const hasExtendedAgentCard =
		options.capabilities?.extendedAgentCard ?? !!options.onGetExtendedAgentCard

	return {
		name: options.agent.name,
		description: options.agent.description,
		supportedInterfaces: interfaces,
		provider: options.agent.provider,
		version: options.agent.version,
		documentationUrl: options.agent.documentationUrl,
		capabilities: {
			streaming: hasStreaming,
			pushNotifications: hasPushNotifications,
			extendedAgentCard: hasExtendedAgentCard,
			extensions: options.agent.extensions
		},
		securitySchemes: options.agent.securitySchemes,
		security: options.agent.security,
		defaultInputModes: options.agent.defaultInputModes || [
			'text/plain',
			'application/json'
		],
		defaultOutputModes: options.agent.defaultOutputModes || [
			'text/plain',
			'application/json'
		],
		skills: options.agent.skills,
		iconUrl: options.agent.iconUrl
	}
}

/**
 * Send push notification to a webhook
 */
async function sendPushNotification(
	url: string,
	payload: StreamResponse,
	auth?: { scheme: string; credentials?: string },
	token?: string
): Promise<void> {
	const headers: Record<string, string> = {
		'Content-Type': A2A_CONTENT_TYPE
	}
	if (auth?.credentials) {
		headers['Authorization'] = `${auth.scheme} ${auth.credentials}`
	}
	if (token) {
		headers['X-A2A-Notification-Token'] = token
	}

	try {
		const res = await fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(30000)
		})
		if (!res.ok) {
			console.warn(
				`[A2A] Push notification to ${url} failed with status ${res.status}`
			)
		}
	} catch (err) {
		console.warn(`[A2A] Push notification to ${url} failed:`, err)
	}
}

/**
 * Notify all push configs for a task
 */
async function notifyPushConfigs(
	store: TaskStore,
	taskId: string,
	payload: StreamResponse
): Promise<void> {
	const configs = await store.listPushConfigs(taskId)
	await Promise.allSettled(
		configs.map((c) =>
			sendPushNotification(
				c.pushNotificationConfig.url,
				payload,
				c.pushNotificationConfig.authentication
					? {
							scheme: c.pushNotificationConfig.authentication.scheme,
							credentials:
								c.pushNotificationConfig.authentication.credentials
						}
					: undefined,
				c.pushNotificationConfig.token
			)
		)
	)
}

// ============================================================================
// Core Operation Handlers
// ============================================================================

async function handleSendMessage(
	params: SendMessageRequest,
	options: A2APluginOptions,
	store: TaskStore
): Promise<{ task?: Task; message?: Message }> {
	const { message, configuration, metadata } = params

	// Find or create task
	let task: Task | undefined
	if (message.taskId) {
		task = await store.get(message.taskId)
		if (!task) {
			throw new TaskNotFoundError(message.taskId)
		}
		// Ensure task accepts new messages (not terminal)
		if (isTerminal(task.status.state)) {
			throw new UnsupportedOperationError(
				`Task '${message.taskId}' is in terminal state '${task.status.state}'`
			)
		}
	}

	// Build handler context
	const ctx: A2AHandlerContext = {
		message,
		task,
		configuration,
		metadata
	}

	// Call user handler
	const result = await options.onMessage(ctx)

	// If the handler returns a direct message (no task)
	if (result.directMessage) {
		const responseMessage: Message = {
			messageId: generateId(),
			role: 'ROLE_AGENT',
			parts: result.directMessage.parts,
			metadata: result.directMessage.metadata,
			contextId: message.contextId || task?.contextId
		}
		return { message: responseMessage }
	}

	// Create or update task
	if (!task) {
		task = createTask(message.contextId, result.metadata)
	}

	// Add user message to history
	task.history = task.history || []
	task.history.push(message)

	// Set artifacts
	if (result.artifacts) {
		task.artifacts = result.artifacts
	}

	// Update status
	const finalState = result.state || 'TASK_STATE_COMPLETED'
	task.status = {
		state: finalState,
		timestamp: now(),
		message: result.statusMessage
			? {
					messageId: generateId(),
					role: 'ROLE_AGENT',
					parts: result.statusMessage.parts,
					metadata: result.statusMessage.metadata
				}
			: undefined
	}

	// Persist
	await store.upsert(task)

	// If push notification config was provided, register it
	if (configuration?.pushNotificationConfig) {
		const configId =
			configuration.pushNotificationConfig.id || generateId()
		await store.createPushConfig(
			task.id,
			configId,
			configuration.pushNotificationConfig
		)

		// Send push notification for the completed/updated task
		if (isTerminal(finalState) || isInterrupted(finalState)) {
			await notifyPushConfigs(store, task.id, { task })
		}
	}

	// If blocking, we already waited. If non-blocking and not done,
	// the task is returned as-is with its current state.
	return { task: trimHistory(task, configuration?.historyLength) }
}

async function* handleStreamMessage(
	params: SendMessageRequest,
	options: A2APluginOptions,
	store: TaskStore
): AsyncGenerator<StreamResponse, void, unknown> {
	if (!options.onStreamMessage) {
		throw new UnsupportedOperationError('Streaming is not supported')
	}

	const { message, configuration, metadata } = params

	// Find or create task
	let task: Task | undefined
	if (message.taskId) {
		task = await store.get(message.taskId)
		if (!task) {
			throw new TaskNotFoundError(message.taskId)
		}
		if (isTerminal(task.status.state)) {
			throw new UnsupportedOperationError(
				`Task '${message.taskId}' is in terminal state`
			)
		}
	}

	const ctx: A2AHandlerContext = {
		message,
		task,
		configuration,
		metadata
	}

	// Create task for tracking
	if (!task) {
		task = createTask(message.contextId)
	}

	task.history = task.history || []
	task.history.push(message)
	await store.upsert(task)

	// Yield initial task
	yield { task }

	// Stream handler events
	const gen = options.onStreamMessage(ctx)

	try {
		for await (const event of gen) {
			if (event.type === 'status') {
				task.status = {
					state: event.state,
					timestamp: now(),
					message: event.message
						? {
								messageId: generateId(),
								role: 'ROLE_AGENT',
								parts: event.message.parts,
								metadata: event.message.metadata
							}
						: undefined
				}
				await store.upsert(task)

				const statusUpdate: StreamResponse = {
					statusUpdate: {
						taskId: task.id,
						contextId: task.contextId,
						status: task.status
					}
				}

				yield statusUpdate

				// Send push notifications
				await notifyPushConfigs(store, task.id, statusUpdate)

				// Stop if terminal
				if (isTerminal(event.state)) {
					break
				}
			} else if (event.type === 'artifact') {
				// Add/update artifact on task
				if (!task.artifacts) task.artifacts = []

				if (event.append) {
					// Append to existing artifact
					const existing = task.artifacts.find(
						(a) => a.artifactId === event.artifact.artifactId
					)
					if (existing) {
						existing.parts.push(...event.artifact.parts)
					} else {
						task.artifacts.push(event.artifact)
					}
				} else {
					const idx = task.artifacts.findIndex(
						(a) => a.artifactId === event.artifact.artifactId
					)
					if (idx >= 0) {
						task.artifacts[idx] = event.artifact
					} else {
						task.artifacts.push(event.artifact)
					}
				}

				await store.upsert(task)

				const artifactUpdate: StreamResponse = {
					artifactUpdate: {
						taskId: task.id,
						contextId: task.contextId,
						artifact: event.artifact,
						append: event.append,
						lastChunk: event.lastChunk
					}
				}

				yield artifactUpdate

				await notifyPushConfigs(store, task.id, artifactUpdate)
			}
		}
	} finally {
		// Ensure task is in a terminal state if the generator ends
		if (!isTerminal(task.status.state) && !isInterrupted(task.status.state)) {
			task.status = {
				state: 'TASK_STATE_COMPLETED',
				timestamp: now()
			}
			await store.upsert(task)

			yield {
				statusUpdate: {
					taskId: task.id,
					contextId: task.contextId,
					status: task.status
				}
			}
		}
	}
}

function isTerminal(state: TaskState): boolean {
	return (
		state === 'TASK_STATE_COMPLETED' ||
		state === 'TASK_STATE_FAILED' ||
		state === 'TASK_STATE_CANCELED' ||
		state === 'TASK_STATE_REJECTED'
	)
}

function isInterrupted(state: TaskState): boolean {
	return (
		state === 'TASK_STATE_INPUT_REQUIRED' ||
		state === 'TASK_STATE_AUTH_REQUIRED'
	)
}

// ============================================================================
// SSE Stream Helper
// ============================================================================

function createSSEStream(
	gen: AsyncGenerator<StreamResponse, void, unknown>,
	jsonRpcId?: string | number
): Response {
	const encoder = new TextEncoder()

	const stream = new ReadableStream({
		async pull(controller) {
			try {
				const { value, done } = await gen.next()
				if (done) {
					controller.close()
					return
				}

				let data: string
				if (jsonRpcId !== undefined) {
					// JSON-RPC wrapping
					data = `data: ${JSON.stringify({
						jsonrpc: '2.0',
						id: jsonRpcId,
						result: value
					})}\n\n`
				} else {
					// Plain REST SSE
					data = `data: ${JSON.stringify(value)}\n\n`
				}
				controller.enqueue(encoder.encode(data))
			} catch (err) {
				if (err instanceof A2AError) {
					const errorData =
						jsonRpcId !== undefined
							? `data: ${JSON.stringify({
									jsonrpc: '2.0',
									id: jsonRpcId,
									error: err.toJsonRpcError()
								})}\n\n`
							: `data: ${JSON.stringify({
									error: err.toProblemDetails()
								})}\n\n`
					controller.enqueue(encoder.encode(errorData))
				}
				controller.close()
			}
		},
		cancel() {
			gen.return(undefined as any)
		}
	})

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	})
}

// ============================================================================
// Main Plugin
// ============================================================================

/**
 * A2A Protocol Plugin for ElysiaJS
 *
 * Adds Agent-to-Agent protocol support with:
 * - Agent Card discovery (/.well-known/agent-card.json)
 * - JSON-RPC 2.0 endpoint (POST /a2a)
 * - HTTP+JSON/REST endpoints
 * - SSE streaming
 * - Pluggable task persistence
 */
export function a2a(options: A2APluginOptions) {
	const store: TaskStore = options.taskStore || new InMemoryTaskStore()
	const basePath = options.basePath || ''

	// We'll build the agent card lazily with the actual base URL
	let agentCard: AgentCard | undefined
	let agentCardJson: string | undefined

	function getAgentCard(request: Request): AgentCard {
		if (!agentCard) {
			const url = new URL(request.url)
			const baseUrl = `${url.protocol}//${url.host}`
			agentCard = buildAgentCard(options, baseUrl)
			agentCardJson = JSON.stringify(agentCard)
		}
		return agentCard
	}

	function getAgentCardJson(request: Request): string {
		if (!agentCardJson) {
			getAgentCard(request)
		}
		return agentCardJson!
	}

	return new Elysia({ name: 'a2a-protocol', seed: options })
		// ================================================================
		// Agent Card Discovery
		// ================================================================
		.get('/.well-known/agent-card.json', ({ request }) => {
			return new Response(getAgentCardJson(request), {
				headers: {
					'Content-Type': 'application/json',
					'Cache-Control': 'public, max-age=3600'
				}
			})
		})

		// ================================================================
		// JSON-RPC 2.0 Endpoint
		// ================================================================
		.post(`${basePath}/a2a`, async ({ request, body }) => {
			let parsed
			try {
				parsed = parseJsonRpcRequest(body)
			} catch (err) {
				if (err instanceof A2AError) {
					return new Response(
						JSON.stringify(jsonRpcError(null, err)),
						{
							status: 200, // JSON-RPC errors still use 200
							headers: { 'Content-Type': A2A_CONTENT_TYPE }
						}
					)
				}
				return new Response(
					JSON.stringify(
						jsonRpcError(null, new JsonRpcParseError())
					),
					{
						status: 200,
						headers: { 'Content-Type': A2A_CONTENT_TYPE }
					}
				)
			}

			const { id, method, params } = parsed

			try {
				// Streaming methods return SSE
				if (STREAMING_METHODS.has(method)) {
					return handleJsonRpcStreamMethod(
						id,
						method,
						params,
						options,
						store,
						request
					)
				}

				// Standard request/response methods
				const result = await handleJsonRpcMethod(
					method,
					params,
					options,
					store,
					request
				)
				return new Response(
					JSON.stringify(jsonRpcSuccess(id, result)),
					{
						status: 200,
						headers: { 'Content-Type': A2A_CONTENT_TYPE }
					}
				)
			} catch (err) {
				if (err instanceof A2AError) {
					return new Response(
						JSON.stringify(jsonRpcError(id, err)),
						{
							status: 200,
							headers: { 'Content-Type': A2A_CONTENT_TYPE }
						}
					)
				}
				return new Response(
					JSON.stringify(
						jsonRpcError(
							id,
							new JsonRpcInternalError(
								err instanceof Error
									? err.message
									: 'Unknown error'
							)
						)
					),
					{
						status: 200,
						headers: { 'Content-Type': A2A_CONTENT_TYPE }
					}
				)
			}
		})

		// ================================================================
		// HTTP+JSON/REST Endpoints
		// ================================================================

		// POST /message/send (maps to POST /message:send per A2A spec)
		.post(`${basePath}/message/send`, async ({ request, body }) => {
			try {
				const params = body as unknown as SendMessageRequest
				if (
					!params ||
					!params.message ||
					!params.message.messageId
				) {
					return new Response(
						JSON.stringify({
							type: 'about:blank',
							title: 'Bad Request',
							status: 400,
							detail: 'Request must include a message with messageId'
						}),
						{
							status: 400,
							headers: {
								'Content-Type': 'application/problem+json'
							}
						}
					)
				}

				const result = await handleSendMessage(
					params,
					options,
					store
				)
				return new Response(JSON.stringify(result), {
					status: 200,
					headers: { 'Content-Type': A2A_CONTENT_TYPE }
				})
			} catch (err) {
				return handleRestError(err)
			}
		})

		// POST /message/stream (maps to POST /message:stream per A2A spec)
		.post(`${basePath}/message/stream`, async ({ request, body }) => {
			try {
				const params = body as unknown as SendMessageRequest
				if (
					!params ||
					!params.message ||
					!params.message.messageId
				) {
					return new Response(
						JSON.stringify({
							type: 'about:blank',
							title: 'Bad Request',
							status: 400,
							detail: 'Request must include a message with messageId'
						}),
						{
							status: 400,
							headers: {
								'Content-Type': 'application/problem+json'
							}
						}
					)
				}

				const gen = handleStreamMessage(params, options, store)
				return createSSEStream(gen)
			} catch (err) {
				return handleRestError(err)
			}
		})

		// GET /tasks/:id
		.get(`${basePath}/tasks/:id`, async ({ params: routeParams, query }) => {
			try {
				const task = await store.get(routeParams.id)
				if (!task) {
					throw new TaskNotFoundError(routeParams.id)
				}
				const historyLength = query.historyLength
					? parseInt(query.historyLength as string, 10)
					: undefined
				return new Response(
					JSON.stringify(trimHistory(task, historyLength)),
					{
						status: 200,
						headers: { 'Content-Type': A2A_CONTENT_TYPE }
					}
				)
			} catch (err) {
				return handleRestError(err)
			}
		})

		// GET /tasks
		.get(`${basePath}/tasks`, async ({ query }) => {
			try {
				const result = await store.list({
					contextId: query.contextId as string | undefined,
					status: query.status as TaskState | undefined,
					pageSize: query.pageSize
						? parseInt(query.pageSize as string, 10)
						: undefined,
					pageToken: query.pageToken as string | undefined,
					statusTimestampAfter: query.statusTimestampAfter as
						| string
						| undefined
				})

				const includeArtifacts = query.includeArtifacts === 'true'
				const historyLength = query.historyLength
					? parseInt(query.historyLength as string, 10)
					: undefined

				const tasks = result.tasks.map((t) =>
					trimHistory(
						stripArtifacts(t, includeArtifacts),
						historyLength
					)
				)

				return new Response(
					JSON.stringify({
						tasks,
						nextPageToken: result.nextPageToken,
						pageSize: tasks.length,
						totalSize: result.totalSize
					}),
					{
						status: 200,
						headers: { 'Content-Type': A2A_CONTENT_TYPE }
					}
				)
			} catch (err) {
				return handleRestError(err)
			}
		})

		// POST /tasks/:id/cancel (maps to tasks/{id}:cancel per A2A spec)
		.post(
			`${basePath}/tasks/:id/cancel`,
			async ({ params: routeParams }) => {
				try {
					const taskId = routeParams.id
					const task = await store.get(taskId)
					if (!task) {
						throw new TaskNotFoundError(taskId)
					}
					if (isTerminal(task.status.state)) {
						throw new TaskNotCancelableError(taskId)
					}

					if (options.onCancelTask) {
						const success = await options.onCancelTask(
							taskId
						)
						if (!success) {
							throw new TaskNotCancelableError(taskId)
						}
					}

					task.status = {
						state: 'TASK_STATE_CANCELED',
						timestamp: now()
					}
					await store.upsert(task)

					// Notify push configs
					await notifyPushConfigs(store, task.id, {
						statusUpdate: {
							taskId: task.id,
							contextId: task.contextId,
							status: task.status
						}
					})

					return new Response(JSON.stringify(task), {
						status: 200,
						headers: { 'Content-Type': A2A_CONTENT_TYPE }
					})
				} catch (err) {
					return handleRestError(err)
				}
			}
		)

		// POST /tasks/:id/subscribe (maps to tasks/{id}:subscribe per A2A spec)
		.post(
			`${basePath}/tasks/:id/subscribe`,
			async ({ params: routeParams }) => {
				try {
					if (!options.onStreamMessage) {
						throw new UnsupportedOperationError(
							'Streaming is not supported'
						)
					}

					const taskId = routeParams.id
					const task = await store.get(taskId)
					if (!task) {
						throw new TaskNotFoundError(taskId)
					}
					if (isTerminal(task.status.state)) {
						throw new UnsupportedOperationError(
							`Task '${taskId}' is in terminal state`
						)
					}

					// Create a subscription stream
					async function* subscribeGenerator(): AsyncGenerator<
						StreamResponse,
						void,
						unknown
					> {
						// First event: current task state
						yield { task: task! }

						// Poll for updates (simple implementation)
						// In production, use event emitters or pub/sub
						let lastState = task!.status.state
						while (true) {
							await new Promise((r) => setTimeout(r, 1000))
							const current = await store.get(taskId)
							if (!current) break

							if (current.status.state !== lastState) {
								yield {
									statusUpdate: {
										taskId: current.id,
										contextId: current.contextId,
										status: current.status
									}
								}
								lastState = current.status.state

								if (isTerminal(lastState)) break
							}
						}
					}

					return createSSEStream(subscribeGenerator())
				} catch (err) {
					return handleRestError(err)
				}
			}
		)

		// Push Notification Config endpoints
		.post(
			`${basePath}/tasks/:id/pushNotificationConfigs`,
			async ({ params: routeParams, body }) => {
				try {
					if (!options.capabilities?.pushNotifications) {
						throw new PushNotificationNotSupportedError()
					}
					const task = await store.get(routeParams.id)
					if (!task) {
						throw new TaskNotFoundError(routeParams.id)
					}
					const reqBody = body as Record<string, unknown>
					const configId =
						(reqBody.configId as string) || generateId()
					const config = reqBody.config || reqBody
					const result = await store.createPushConfig(
						routeParams.id,
						configId,
						config as any
					)
					return new Response(JSON.stringify(result), {
						status: 201,
						headers: { 'Content-Type': A2A_CONTENT_TYPE }
					})
				} catch (err) {
					return handleRestError(err)
				}
			}
		)

		.get(
			`${basePath}/tasks/:id/pushNotificationConfigs/:configId`,
			async ({ params: routeParams }) => {
				try {
					if (!options.capabilities?.pushNotifications) {
						throw new PushNotificationNotSupportedError()
					}
					const config = await store.getPushConfig(
						routeParams.id,
						routeParams.configId
					)
					if (!config) {
						throw new TaskNotFoundError(routeParams.id)
					}
					return new Response(JSON.stringify(config), {
						status: 200,
						headers: { 'Content-Type': A2A_CONTENT_TYPE }
					})
				} catch (err) {
					return handleRestError(err)
				}
			}
		)

		.get(
			`${basePath}/tasks/:id/pushNotificationConfigs`,
			async ({ params: routeParams }) => {
				try {
					if (!options.capabilities?.pushNotifications) {
						throw new PushNotificationNotSupportedError()
					}
					const configs = await store.listPushConfigs(
						routeParams.id
					)
					return new Response(JSON.stringify({ configs }), {
						status: 200,
						headers: { 'Content-Type': A2A_CONTENT_TYPE }
					})
				} catch (err) {
					return handleRestError(err)
				}
			}
		)

		.delete(
			`${basePath}/tasks/:id/pushNotificationConfigs/:configId`,
			async ({ params: routeParams }) => {
				try {
					if (!options.capabilities?.pushNotifications) {
						throw new PushNotificationNotSupportedError()
					}
					await store.deletePushConfig(
						routeParams.id,
						routeParams.configId
					)
					return new Response(null, { status: 204 })
				} catch (err) {
					return handleRestError(err)
				}
			}
		)

		// GET /extendedAgentCard
		.get(`${basePath}/extendedAgentCard`, async ({ request }) => {
			try {
				const card = getAgentCard(request)
				if (!card.capabilities.extendedAgentCard) {
					throw new UnsupportedOperationError(
						'Extended agent card is not supported'
					)
				}
				if (!options.onGetExtendedAgentCard) {
					throw new UnsupportedOperationError(
						'Extended agent card handler not configured'
					)
				}
				const extended = await options.onGetExtendedAgentCard(request)
				if (!extended) {
					throw new UnsupportedOperationError(
						'Extended agent card not available'
					)
				}
				return new Response(JSON.stringify(extended), {
					status: 200,
					headers: { 'Content-Type': A2A_CONTENT_TYPE }
				})
			} catch (err) {
				return handleRestError(err)
			}
		})
}

// ============================================================================
// JSON-RPC Method Dispatcher
// ============================================================================

async function handleJsonRpcMethod(
	method: string,
	params: Record<string, unknown> | undefined,
	options: A2APluginOptions,
	store: TaskStore,
	request: Request
): Promise<unknown> {
	switch (method) {
		case A2A_METHODS.SEND_MESSAGE: {
			const validated = validateSendMessageParams(params)
			return await handleSendMessage(validated, options, store)
		}

		case A2A_METHODS.GET_TASK: {
			const validated = validateGetTaskParams(params)
			const task = await store.get(validated.id)
			if (!task) throw new TaskNotFoundError(validated.id)
			return trimHistory(task, validated.historyLength)
		}

		case A2A_METHODS.LIST_TASKS: {
			const validated = validateListTasksParams(params)
			const result = await store.list({
				contextId: validated.contextId,
				status: validated.status,
				pageSize: validated.pageSize,
				pageToken: validated.pageToken,
				statusTimestampAfter: validated.statusTimestampAfter
			})
			const includeArtifacts = validated.includeArtifacts ?? false
			const tasks = result.tasks.map((t) =>
				trimHistory(
					stripArtifacts(t, includeArtifacts),
					validated.historyLength
				)
			)
			return {
				tasks,
				nextPageToken: result.nextPageToken,
				pageSize: tasks.length,
				totalSize: result.totalSize
			}
		}

		case A2A_METHODS.CANCEL_TASK: {
			const validated = validateCancelTaskParams(params)
			const task = await store.get(validated.id)
			if (!task) throw new TaskNotFoundError(validated.id)
			if (isTerminal(task.status.state)) {
				throw new TaskNotCancelableError(validated.id)
			}
			if (options.onCancelTask) {
				const success = await options.onCancelTask(validated.id)
				if (!success) throw new TaskNotCancelableError(validated.id)
			}
			task.status = { state: 'TASK_STATE_CANCELED', timestamp: now() }
			await store.upsert(task)
			await notifyPushConfigs(store, task.id, {
				statusUpdate: {
					taskId: task.id,
					contextId: task.contextId,
					status: task.status
				}
			})
			return task
		}

		case A2A_METHODS.CREATE_PUSH_CONFIG: {
			if (!options.capabilities?.pushNotifications) {
				throw new PushNotificationNotSupportedError()
			}
			const validated = validateCreatePushConfigParams(params)
			const task = await store.get(validated.taskId)
			if (!task) throw new TaskNotFoundError(validated.taskId)
			return await store.createPushConfig(
				validated.taskId,
				validated.configId,
				validated.config
			)
		}

		case A2A_METHODS.GET_PUSH_CONFIG: {
			if (!options.capabilities?.pushNotifications) {
				throw new PushNotificationNotSupportedError()
			}
			const validated = validateGetPushConfigParams(params)
			const config = await store.getPushConfig(
				validated.taskId,
				validated.id
			)
			if (!config) throw new TaskNotFoundError(validated.taskId)
			return config
		}

		case A2A_METHODS.LIST_PUSH_CONFIGS: {
			if (!options.capabilities?.pushNotifications) {
				throw new PushNotificationNotSupportedError()
			}
			if (
				!params ||
				!params.taskId ||
				typeof params.taskId !== 'string'
			) {
				throw new TaskNotFoundError('unknown')
			}
			return { configs: await store.listPushConfigs(params.taskId) }
		}

		case A2A_METHODS.DELETE_PUSH_CONFIG: {
			if (!options.capabilities?.pushNotifications) {
				throw new PushNotificationNotSupportedError()
			}
			const validated = validateDeletePushConfigParams(params)
			await store.deletePushConfig(validated.taskId, validated.id)
			return {}
		}

		case A2A_METHODS.GET_EXTENDED_AGENT_CARD: {
			if (!options.onGetExtendedAgentCard) {
				throw new UnsupportedOperationError(
					'Extended agent card not supported'
				)
			}
			const card = await options.onGetExtendedAgentCard(request)
			if (!card) {
				throw new UnsupportedOperationError(
					'Extended agent card not available'
				)
			}
			return card
		}

		default:
			throw new JsonRpcMethodNotFoundError(method)
	}
}

function handleJsonRpcStreamMethod(
	id: string | number,
	method: string,
	params: Record<string, unknown> | undefined,
	options: A2APluginOptions,
	store: TaskStore,
	request: Request
): Response {
	if (!options.onStreamMessage) {
		throw new UnsupportedOperationError('Streaming is not supported')
	}

	if (method === A2A_METHODS.SEND_STREAMING_MESSAGE) {
		const validated = validateSendMessageParams(params)
		const gen = handleStreamMessage(validated, options, store)
		return createSSEStream(gen, id)
	}

	if (method === A2A_METHODS.SUBSCRIBE_TO_TASK) {
		const validated = validateSubscribeToTaskParams(params)

		async function* subscribeGen(): AsyncGenerator<
			StreamResponse,
			void,
			unknown
		> {
			const task = await store.get(validated.id)
			if (!task) throw new TaskNotFoundError(validated.id)
			if (isTerminal(task.status.state)) {
				throw new UnsupportedOperationError(
					`Task '${validated.id}' is in terminal state`
				)
			}

			yield { task }

			let lastState = task.status.state
			while (true) {
				await new Promise((r) => setTimeout(r, 1000))
				const current = await store.get(validated.id)
				if (!current) break
				if (current.status.state !== lastState) {
					yield {
						statusUpdate: {
							taskId: current.id,
							contextId: current.contextId,
							status: current.status
						}
					}
					lastState = current.status.state
					if (isTerminal(lastState)) break
				}
			}
		}

		return createSSEStream(subscribeGen(), id)
	}

	throw new JsonRpcMethodNotFoundError(method)
}

// ============================================================================
// REST Error Handler
// ============================================================================

function handleRestError(err: unknown): Response {
	if (err instanceof A2AError) {
		return err.toResponse()
	}
	return new Response(
		JSON.stringify({
			type: 'about:blank',
			title: 'Internal Server Error',
			status: 500,
			detail:
				err instanceof Error ? err.message : 'An unknown error occurred'
		}),
		{
			status: 500,
			headers: { 'Content-Type': 'application/problem+json' }
		}
	)
}

// ============================================================================
// Re-exports
// ============================================================================

export type {
	A2APluginOptions,
	A2AHandlerContext,
	A2AHandlerResult,
	A2AStreamEvent,
	AgentCard,
	AgentSkill,
	AgentCapabilities,
	AgentProvider,
	AgentInterface,
	Task,
	TaskState,
	TaskStatus,
	Message,
	Part,
	Artifact,
	StreamResponse,
	SendMessageRequest,
	SendMessageConfiguration,
	PushNotificationConfig,
	TaskPushNotificationConfig,
	TaskStore
} from './types'

export { InMemoryTaskStore } from './task-store'
export {
	A2AError,
	TaskNotFoundError,
	TaskNotCancelableError,
	PushNotificationNotSupportedError,
	UnsupportedOperationError,
	ContentTypeNotSupportedError,
	InvalidAgentResponseError,
	VersionNotSupportedError
} from './errors'
