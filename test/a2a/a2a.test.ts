/**
 * A2A Protocol Tests
 *
 * Comprehensive tests for the A2A plugin covering:
 * - Agent Card discovery
 * - JSON-RPC 2.0 operations
 * - HTTP+JSON/REST operations
 * - SSE streaming
 * - Task lifecycle management
 * - Error handling
 * - Task store
 */

import { Elysia } from '../../src'
import { a2a, InMemoryTaskStore } from '../../src/a2a'
import type {
	A2AHandlerContext,
	A2AStreamEvent,
	A2APluginOptions
} from '../../src/a2a'

import { describe, expect, it, beforeEach } from 'bun:test'

// ============================================================================
// Helpers
// ============================================================================

const req = (path: string, options?: RequestInit) =>
	new Request(`http://localhost${path}`, options)

const jsonRpc = (
	method: string,
	params: Record<string, unknown>,
	id: string | number = '1'
) =>
	new Request('http://localhost/a2a', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
	})

const restPost = (path: string, body: Record<string, unknown>) =>
	new Request(`http://localhost${path}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	})

const restGet = (path: string) =>
	new Request(`http://localhost${path}`, { method: 'GET' })

const restDelete = (path: string) =>
	new Request(`http://localhost${path}`, { method: 'DELETE' })

/** Parse JSON response as any to avoid TypeScript unknown type issues in tests */
const json = (res: Response): Promise<any> => res.json() as Promise<any>

function createMessage(
	text: string,
	messageId?: string,
	taskId?: string
) {
	return {
		messageId: messageId || crypto.randomUUID(),
		role: 'ROLE_USER' as const,
		parts: [{ text }],
		...(taskId ? { taskId } : {})
	}
}

/** Default handler options for tests */
function createDefaultOptions(
	overrides?: Partial<A2APluginOptions>
): A2APluginOptions {
	return {
		agent: {
			name: 'Test Agent',
			description: 'Test agent for unit tests',
			version: '1.0.0',
			skills: [
				{
					id: 'test',
					name: 'Test Skill',
					description: 'A test skill',
					tags: ['test']
				}
			]
		},
		async onMessage(ctx: A2AHandlerContext) {
			const text = ctx.message.parts
				.filter((p) => p.text)
				.map((p) => p.text)
				.join(' ')
			return {
				artifacts: [
					{
						artifactId: crypto.randomUUID(),
						parts: [{ text: `Echo: ${text}` }]
					}
				],
				state: 'TASK_STATE_COMPLETED'
			}
		},
		...overrides
	}
}

function createApp(overrides?: Partial<A2APluginOptions>) {
	return new Elysia().use(a2a(createDefaultOptions(overrides)))
}

/** Read all SSE events from a streaming response */
async function readSSEEvents(response: Response): Promise<unknown[]> {
	const text = await response.text()
	const events: unknown[] = []
	const lines = text.split('\n')
	for (const line of lines) {
		if (line.startsWith('data: ')) {
			try {
				events.push(JSON.parse(line.slice(6)))
			} catch {
				// ignore parse errors
			}
		}
	}
	return events
}

// ============================================================================
// Agent Card Discovery
// ============================================================================

describe('A2A Agent Card', () => {
	it('serves agent card at well-known URL', async () => {
		const app = createApp()
		const res = await app.handle(req('/.well-known/agent-card.json'))

		expect(res.status).toBe(200)
		expect(res.headers.get('Content-Type')).toBe('application/json')
		expect(res.headers.get('Cache-Control')).toContain('public')

		const card = await json(res)
		expect(card.name).toBe('Test Agent')
		expect(card.description).toBe('Test agent for unit tests')
		expect(card.version).toBe('1.0.0')
	})

	it('includes supported interfaces', async () => {
		const app = createApp()
		const res = await app.handle(req('/.well-known/agent-card.json'))
		const card = await json(res)

		expect(card.supportedInterfaces).toBeArray()
		expect(card.supportedInterfaces.length).toBeGreaterThanOrEqual(1)

		const jsonrpcInterface = card.supportedInterfaces.find(
			(i: any) => i.protocolBinding === 'JSONRPC'
		)
		expect(jsonrpcInterface).toBeDefined()
		expect(jsonrpcInterface.url).toContain('/a2a')
		expect(jsonrpcInterface.protocolVersion).toBe('1.0')
	})

	it('includes skills', async () => {
		const app = createApp()
		const res = await app.handle(req('/.well-known/agent-card.json'))
		const card = await json(res)

		expect(card.skills).toBeArray()
		expect(card.skills).toHaveLength(1)
		expect(card.skills[0].id).toBe('test')
		expect(card.skills[0].name).toBe('Test Skill')
	})

	it('includes capabilities', async () => {
		const app = createApp({ capabilities: { streaming: true } })
		const res = await app.handle(req('/.well-known/agent-card.json'))
		const card = await json(res)

		expect(card.capabilities).toBeDefined()
		expect(card.capabilities.streaming).toBe(true)
	})

	it('auto-detects streaming capability from handler presence', async () => {
		const app = createApp({
			async *onStreamMessage() {
				yield { type: 'status', state: 'TASK_STATE_COMPLETED' }
			}
		})
		const res = await app.handle(req('/.well-known/agent-card.json'))
		const card = await json(res)

		expect(card.capabilities.streaming).toBe(true)
	})

	it('includes default input/output modes', async () => {
		const app = createApp()
		const res = await app.handle(req('/.well-known/agent-card.json'))
		const card = await json(res)

		expect(card.defaultInputModes).toContain('text/plain')
		expect(card.defaultOutputModes).toContain('text/plain')
	})
})

// ============================================================================
// JSON-RPC 2.0 - SendMessage
// ============================================================================

describe('A2A JSON-RPC SendMessage', () => {
	it('sends a message and gets a task result', async () => {
		const app = createApp()
		const res = await app.handle(
			jsonRpc('SendMessage', {
				message: createMessage('Hello world')
			})
		)

		expect(res.status).toBe(200)
		const body = await json(res)
		expect(body.jsonrpc).toBe('2.0')
		expect(body.id).toBe('1')
		expect(body.result).toBeDefined()
		expect(body.result.task).toBeDefined()
		expect(body.result.task.status.state).toBe('TASK_STATE_COMPLETED')
		expect(body.result.task.artifacts).toBeArray()
		expect(body.result.task.artifacts[0].parts[0].text).toContain(
			'Echo: Hello world'
		)
	})

	it('returns a direct message when handler provides one', async () => {
		const app = createApp({
			async onMessage(ctx) {
				return {
					directMessage: {
						parts: [{ text: 'Direct reply!' }]
					}
				}
			}
		})

		const res = await app.handle(
			jsonRpc('SendMessage', {
				message: createMessage('Hi')
			})
		)

		const body = await json(res)
		expect(body.result.message).toBeDefined()
		expect(body.result.message.role).toBe('ROLE_AGENT')
		expect(body.result.message.parts[0].text).toBe('Direct reply!')
	})

	it('creates a task with a unique ID', async () => {
		const app = createApp()
		const res1 = await app.handle(
			jsonRpc('SendMessage', {
				message: createMessage('First')
			})
		)
		const res2 = await app.handle(
			jsonRpc(
				'SendMessage',
				{ message: createMessage('Second') },
				'2'
			)
		)

		const task1 = (await json(res1)).result.task
		const task2 = (await json(res2)).result.task
		expect(task1.id).not.toBe(task2.id)
	})

	it('validates missing message', async () => {
		const app = createApp()
		const res = await app.handle(jsonRpc('SendMessage', {}))

		const body = await json(res)
		expect(body.error).toBeDefined()
		expect(body.error.code).toBe(-32602)
	})

	it('validates missing messageId', async () => {
		const app = createApp()
		const res = await app.handle(
			jsonRpc('SendMessage', {
				message: { role: 'ROLE_USER', parts: [{ text: 'hi' }] }
			})
		)

		const body = await json(res)
		expect(body.error).toBeDefined()
		expect(body.error.code).toBe(-32602)
	})
})

// ============================================================================
// JSON-RPC 2.0 - GetTask
// ============================================================================

describe('A2A JSON-RPC GetTask', () => {
	it('retrieves a previously created task', async () => {
		const app = createApp()

		// Create a task first
		const sendRes = await app.handle(
			jsonRpc('SendMessage', {
				message: createMessage('Create task')
			})
		)
		const taskId = (await json(sendRes)).result.task.id

		// Get the task
		const getRes = await app.handle(
			jsonRpc('GetTask', { id: taskId }, '2')
		)
		const body = await json(getRes)

		expect(body.result).toBeDefined()
		expect(body.result.id).toBe(taskId)
		expect(body.result.status.state).toBe('TASK_STATE_COMPLETED')
	})

	it('returns error for non-existent task', async () => {
		const app = createApp()
		const res = await app.handle(
			jsonRpc('GetTask', { id: 'nonexistent-id' })
		)
		const body = await json(res)

		expect(body.error).toBeDefined()
		expect(body.error.code).toBe(-32001) // TaskNotFound
	})

	it('supports historyLength parameter', async () => {
		const app = createApp()

		const sendRes = await app.handle(
			jsonRpc('SendMessage', {
				message: createMessage('With history')
			})
		)
		const taskId = (await json(sendRes)).result.task.id

		// Get with historyLength=0
		const getRes = await app.handle(
			jsonRpc('GetTask', { id: taskId, historyLength: 0 }, '2')
		)
		const body = await json(getRes)

		expect(body.result.history).toBeUndefined()
	})
})

// ============================================================================
// JSON-RPC 2.0 - CancelTask
// ============================================================================

describe('A2A JSON-RPC CancelTask', () => {
	it('cancels a non-terminal task', async () => {
		const app = createApp({
			async onMessage() {
				return {
					artifacts: [],
					state: 'TASK_STATE_WORKING'
				}
			},
			async onCancelTask() {
				return true
			}
		})

		const sendRes = await app.handle(
			jsonRpc('SendMessage', {
				message: createMessage('Create task')
			})
		)
		const taskId = (await json(sendRes)).result.task.id

		const cancelRes = await app.handle(
			jsonRpc('CancelTask', { id: taskId }, '2')
		)
		const body = await json(cancelRes)

		expect(body.result).toBeDefined()
		expect(body.result.status.state).toBe('TASK_STATE_CANCELED')
	})

	it('fails to cancel a completed task', async () => {
		const app = createApp()

		const sendRes = await app.handle(
			jsonRpc('SendMessage', {
				message: createMessage('Complete this')
			})
		)
		const taskId = (await json(sendRes)).result.task.id

		const cancelRes = await app.handle(
			jsonRpc('CancelTask', { id: taskId }, '2')
		)
		const body = await json(cancelRes)

		expect(body.error).toBeDefined()
		expect(body.error.code).toBe(-32002) // TaskNotCancelable
	})
})

// ============================================================================
// JSON-RPC 2.0 - ListTasks
// ============================================================================

describe('A2A JSON-RPC ListTasks', () => {
	it('lists tasks', async () => {
		const store = new InMemoryTaskStore()
		const app = createApp({ taskStore: store })

		// Create a few tasks
		await app.handle(
			jsonRpc('SendMessage', { message: createMessage('Task 1') })
		)
		await app.handle(
			jsonRpc(
				'SendMessage',
				{ message: createMessage('Task 2') },
				'2'
			)
		)

		const listRes = await app.handle(
			jsonRpc('ListTasks', {}, '3')
		)
		const body = await json(listRes)

		expect(body.result).toBeDefined()
		expect(body.result.tasks).toBeArray()
		expect(body.result.tasks.length).toBe(2)
	})

	it('supports pagination', async () => {
		const store = new InMemoryTaskStore()
		const app = createApp({ taskStore: store })

		// Create 3 tasks
		for (let i = 0; i < 3; i++) {
			await app.handle(
				jsonRpc(
					'SendMessage',
					{ message: createMessage(`Task ${i}`) },
					String(i + 1)
				)
			)
		}

		// List with page size 2
		const page1Res = await app.handle(
			jsonRpc('ListTasks', { pageSize: 2 }, '10')
		)
		const page1 = await json(page1Res)

		expect(page1.result.tasks.length).toBe(2)
		expect(page1.result.nextPageToken).toBeTruthy()

		// Get page 2
		const page2Res = await app.handle(
			jsonRpc(
				'ListTasks',
				{ pageSize: 2, pageToken: page1.result.nextPageToken },
				'11'
			)
		)
		const page2 = await json(page2Res)

		expect(page2.result.tasks.length).toBe(1)
	})
})

// ============================================================================
// JSON-RPC 2.0 - Error Handling
// ============================================================================

describe('A2A JSON-RPC Errors', () => {
	it('rejects invalid JSON-RPC version', async () => {
		const app = createApp()
		const res = await app.handle(
			new Request('http://localhost/a2a', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					jsonrpc: '1.0',
					id: '1',
					method: 'GetTask',
					params: { id: 'x' }
				})
			})
		)

		const body = await json(res)
		expect(body.error).toBeDefined()
		expect(body.error.code).toBe(-32600) // Invalid Request
	})

	it('rejects unknown method', async () => {
		const app = createApp()
		const res = await app.handle(
			jsonRpc('UnknownMethod', { id: 'x' })
		)

		const body = await json(res)
		expect(body.error).toBeDefined()
		expect(body.error.code).toBe(-32601) // Method not found
	})

	it('rejects missing id', async () => {
		const app = createApp()
		const res = await app.handle(
			new Request('http://localhost/a2a', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					jsonrpc: '2.0',
					method: 'GetTask',
					params: { id: 'x' }
				})
			})
		)

		const body = await json(res)
		expect(body.error).toBeDefined()
		expect(body.error.code).toBe(-32600) // Invalid Request
	})
})

// ============================================================================
// HTTP+JSON/REST - SendMessage
// ============================================================================

describe('A2A REST SendMessage', () => {
	it('sends a message via REST', async () => {
		const app = createApp()
		const res = await app.handle(
			restPost('/message/send', {
				message: createMessage('Hello REST')
			})
		)

		expect(res.status).toBe(200)
		const body = await json(res)
		expect(body.task).toBeDefined()
		expect(body.task.status.state).toBe('TASK_STATE_COMPLETED')
		expect(body.task.artifacts[0].parts[0].text).toContain(
			'Echo: Hello REST'
		)
	})

	it('returns 400 for missing message', async () => {
		const app = createApp()
		const res = await app.handle(restPost('/message/send', {}))

		expect(res.status).toBe(400)
	})
})

// ============================================================================
// HTTP+JSON/REST - GetTask
// ============================================================================

describe('A2A REST GetTask', () => {
	it('gets a task by ID', async () => {
		const app = createApp()

		const sendRes = await app.handle(
			restPost('/message/send', {
				message: createMessage('Create for GET')
			})
		)
		const taskId = (await json(sendRes)).task.id

		const getRes = await app.handle(restGet(`/tasks/${taskId}`))
		expect(getRes.status).toBe(200)

		const body = await json(getRes)
		expect(body.id).toBe(taskId)
	})

	it('returns 404 for non-existent task', async () => {
		const app = createApp()
		const res = await app.handle(restGet('/tasks/nonexistent'))

		expect(res.status).toBe(404)
	})
})

// ============================================================================
// HTTP+JSON/REST - ListTasks
// ============================================================================

describe('A2A REST ListTasks', () => {
	it('lists all tasks', async () => {
		const store = new InMemoryTaskStore()
		const app = createApp({ taskStore: store })

		await app.handle(
			restPost('/message/send', {
				message: createMessage('List task 1')
			})
		)
		await app.handle(
			restPost('/message/send', {
				message: createMessage('List task 2')
			})
		)

		const res = await app.handle(restGet('/tasks'))
		expect(res.status).toBe(200)

		const body = await json(res)
		expect(body.tasks).toBeArray()
		expect(body.tasks.length).toBe(2)
	})
})

// ============================================================================
// HTTP+JSON/REST - CancelTask
// ============================================================================

describe('A2A REST CancelTask', () => {
	it('cancels a task', async () => {
		const app = createApp({
			async onMessage() {
				return { artifacts: [], state: 'TASK_STATE_WORKING' }
			},
			async onCancelTask() {
				return true
			}
		})

		const sendRes = await app.handle(
			restPost('/message/send', {
				message: createMessage('Cancel me')
			})
		)
		const taskId = (await json(sendRes)).task.id

		const cancelRes = await app.handle(
			restPost(`/tasks/${taskId}/cancel`, {})
		)
		expect(cancelRes.status).toBe(200)

		const body = await json(cancelRes)
		expect(body.status.state).toBe('TASK_STATE_CANCELED')
	})
})

// ============================================================================
// SSE Streaming
// ============================================================================

describe('A2A Streaming', () => {
	const streamingOptions: Partial<A2APluginOptions> = {
		capabilities: { streaming: true },
		async *onStreamMessage(
			ctx: A2AHandlerContext
		): AsyncGenerator<A2AStreamEvent, void, unknown> {
			yield {
				type: 'status',
				state: 'TASK_STATE_WORKING',
				message: { parts: [{ text: 'Working...' }] }
			}

			yield {
				type: 'artifact',
				artifact: {
					artifactId: 'art-1',
					parts: [{ text: 'chunk 1' }]
				},
				lastChunk: false
			}

			yield {
				type: 'artifact',
				artifact: {
					artifactId: 'art-1',
					parts: [{ text: 'chunk 2' }]
				},
				append: true,
				lastChunk: true
			}

			yield {
				type: 'status',
				state: 'TASK_STATE_COMPLETED',
				message: { parts: [{ text: 'Done!' }] }
			}
		}
	}

	it('streams via REST endpoint', async () => {
		const app = createApp(streamingOptions)

		const res = await app.handle(
			restPost('/message/stream', {
				message: createMessage('Stream me')
			})
		)

		expect(res.status).toBe(200)
		expect(res.headers.get('Content-Type')).toBe('text/event-stream')

		const events = await readSSEEvents(res)
		expect(events.length).toBeGreaterThanOrEqual(3)

		// First event should be the initial task
		const firstEvent = events[0] as any
		expect(firstEvent.task).toBeDefined()
	})

	it('streams via JSON-RPC', async () => {
		const app = createApp(streamingOptions)

		const res = await app.handle(
			jsonRpc('SendStreamingMessage', {
				message: createMessage('Stream via RPC')
			})
		)

		expect(res.status).toBe(200)
		expect(res.headers.get('Content-Type')).toBe('text/event-stream')

		const events = await readSSEEvents(res)
		expect(events.length).toBeGreaterThanOrEqual(3)

		// JSON-RPC wrapping
		const firstEvent = events[0] as any
		expect(firstEvent.jsonrpc).toBe('2.0')
		expect(firstEvent.id).toBe('1')
		expect(firstEvent.result).toBeDefined()
	})

	it('returns error when streaming not supported', async () => {
		const app = createApp()

		const res = await app.handle(
			jsonRpc('SendStreamingMessage', {
				message: createMessage('Stream not supported')
			})
		)

		const body = await json(res)
		expect(body.error).toBeDefined()
		expect(body.error.code).toBe(-32004) // Unsupported operation
	})
})

// ============================================================================
// InMemoryTaskStore
// ============================================================================

describe('InMemoryTaskStore', () => {
	let store: InMemoryTaskStore

	beforeEach(() => {
		store = new InMemoryTaskStore()
	})

	it('upserts and gets a task', async () => {
		const task = {
			id: 'task-1',
			contextId: 'ctx-1',
			status: {
				state: 'TASK_STATE_SUBMITTED' as const,
				timestamp: new Date().toISOString()
			},
			artifacts: [],
			history: []
		}

		await store.upsert(task)
		const retrieved = await store.get('task-1')

		expect(retrieved).toBeDefined()
		expect(retrieved!.id).toBe('task-1')
		expect(retrieved!.contextId).toBe('ctx-1')
	})

	it('returns undefined for non-existent task', async () => {
		const result = await store.get('nonexistent')
		expect(result).toBeUndefined()
	})

	it('lists tasks with filtering', async () => {
		const task1 = {
			id: 'task-1',
			contextId: 'ctx-1',
			status: {
				state: 'TASK_STATE_COMPLETED' as const,
				timestamp: new Date().toISOString()
			},
			artifacts: [],
			history: []
		}
		const task2 = {
			id: 'task-2',
			contextId: 'ctx-1',
			status: {
				state: 'TASK_STATE_WORKING' as const,
				timestamp: new Date().toISOString()
			},
			artifacts: [],
			history: []
		}
		const task3 = {
			id: 'task-3',
			contextId: 'ctx-2',
			status: {
				state: 'TASK_STATE_COMPLETED' as const,
				timestamp: new Date().toISOString()
			},
			artifacts: [],
			history: []
		}

		await store.upsert(task1)
		await store.upsert(task2)
		await store.upsert(task3)

		// Filter by contextId
		const ctx1Tasks = await store.list({ contextId: 'ctx-1' })
		expect(ctx1Tasks.tasks.length).toBe(2)

		// Filter by status
		const completedTasks = await store.list({
			status: 'TASK_STATE_COMPLETED'
		})
		expect(completedTasks.tasks.length).toBe(2)

		// Multiple filters
		const ctx1Completed = await store.list({
			contextId: 'ctx-1',
			status: 'TASK_STATE_COMPLETED'
		})
		expect(ctx1Completed.tasks.length).toBe(1)
		expect(ctx1Completed.tasks[0].id).toBe('task-1')
	})

	it('supports pagination', async () => {
		for (let i = 0; i < 5; i++) {
			await store.upsert({
				id: `task-${i}`,
				contextId: 'ctx-1',
				status: {
					state: 'TASK_STATE_COMPLETED' as const,
					timestamp: new Date(
						Date.now() + i * 1000
					).toISOString()
				},
				artifacts: [],
				history: []
			})
		}

		// Page 1
		const page1 = await store.list({ pageSize: 2 })
		expect(page1.tasks.length).toBe(2)
		expect(page1.nextPageToken).toBeTruthy()
		expect(page1.totalSize).toBe(5)

		// Page 2
		const page2 = await store.list({
			pageSize: 2,
			pageToken: page1.nextPageToken
		})
		expect(page2.tasks.length).toBe(2)

		// Page 3
		const page3 = await store.list({
			pageSize: 2,
			pageToken: page2.nextPageToken
		})
		expect(page3.tasks.length).toBe(1)
	})

	it('deletes a task', async () => {
		await store.upsert({
			id: 'task-del',
			contextId: 'ctx-1',
			status: {
				state: 'TASK_STATE_COMPLETED' as const,
				timestamp: new Date().toISOString()
			},
			artifacts: [],
			history: []
		})

		expect(await store.get('task-del')).toBeDefined()
		await store.delete('task-del')
		expect(await store.get('task-del')).toBeUndefined()
	})

	it('enforces maxTasks LRU eviction', async () => {
		const smallStore = new InMemoryTaskStore({ maxTasks: 3 })

		for (let i = 0; i < 5; i++) {
			await smallStore.upsert({
				id: `task-${i}`,
				contextId: 'ctx-1',
				status: {
					state: 'TASK_STATE_COMPLETED' as const,
					timestamp: new Date().toISOString()
				},
				artifacts: [],
				history: []
			})
		}

		// Only 3 should remain
		const list = await smallStore.list({})
		expect(list.totalSize).toBe(3)

		// Oldest should have been evicted
		expect(await smallStore.get('task-0')).toBeUndefined()
		expect(await smallStore.get('task-1')).toBeUndefined()
		expect(await smallStore.get('task-2')).toBeDefined()
	})

	it('returns immutable copies', async () => {
		await store.upsert({
			id: 'task-immutable',
			contextId: 'ctx-1',
			status: {
				state: 'TASK_STATE_WORKING' as const,
				timestamp: new Date().toISOString()
			},
			artifacts: [],
			history: []
		})

		const copy1 = await store.get('task-immutable')
		const copy2 = await store.get('task-immutable')

		expect(copy1).not.toBe(copy2) // Different references
		expect(copy1).toEqual(copy2) // Same data
	})
})

// ============================================================================
// Task Lifecycle
// ============================================================================

describe('A2A Task Lifecycle', () => {
	it('follows message to existing task', async () => {
		const store = new InMemoryTaskStore()
		const app = createApp({
			taskStore: store,
			async onMessage(ctx) {
				if (ctx.task) {
					return {
						artifacts: [
							{
								artifactId: 'art-1',
								parts: [
									{
										text: `Follow-up for task ${ctx.task.id}`
									}
								]
							}
						],
						state: 'TASK_STATE_COMPLETED'
					}
				}
				return {
					artifacts: [],
					state: 'TASK_STATE_INPUT_REQUIRED',
					statusMessage: {
						parts: [{ text: 'Need more info' }]
					}
				}
			}
		})

		// Create initial task
		const sendRes = await app.handle(
			jsonRpc('SendMessage', {
				message: createMessage('Initial')
			})
		)
		const sendBody = await json(sendRes)
		const taskId = sendBody.result.task.id

		// Follow up on the task
		const followUpRes = await app.handle(
			jsonRpc(
				'SendMessage',
				{
					message: createMessage(
						'Follow up',
						undefined,
						taskId
					)
				},
				'2'
			)
		)
		const followUpBody = await json(followUpRes)

		expect(followUpBody.result.task).toBeDefined()
		expect(followUpBody.result.task.id).toBe(taskId)
		expect(followUpBody.result.task.status.state).toBe(
			'TASK_STATE_COMPLETED'
		)
	})

	it('returns error when following up on terminal task', async () => {
		const app = createApp()

		const sendRes = await app.handle(
			jsonRpc('SendMessage', {
				message: createMessage('Complete this')
			})
		)
		const taskId = (await json(sendRes)).result.task.id

		// Try to follow up on completed task
		const followUpRes = await app.handle(
			jsonRpc(
				'SendMessage',
				{
					message: createMessage(
						'Follow up on completed',
						undefined,
						taskId
					)
				},
				'2'
			)
		)
		const body = await json(followUpRes)

		expect(body.error).toBeDefined()
		expect(body.error.code).toBe(-32004) // Unsupported operation
	})
})

// ============================================================================
// Push Notification Config
// ============================================================================

describe('A2A Push Notification Config', () => {
	function createPushApp() {
		const store = new InMemoryTaskStore()
		return createApp({
			taskStore: store,
			capabilities: { pushNotifications: true },
			async onMessage() {
				return {
					artifacts: [],
					state: 'TASK_STATE_WORKING'
				}
			}
		})
	}

	it('creates a push notification config', async () => {
		const app = createPushApp()

		// Create task
		const sendRes = await app.handle(
			jsonRpc('SendMessage', {
				message: createMessage('Push test')
			})
		)
		const taskId = (await json(sendRes)).result.task.id

		// Create push config via JSON-RPC
		const createRes = await app.handle(
			jsonRpc(
				'CreateTaskPushNotificationConfig',
				{
					taskId,
					configId: 'config-1',
					config: {
						url: 'https://example.com/webhook',
						token: 'test-token'
					}
				},
				'2'
			)
		)
		const body = await json(createRes)

		expect(body.result).toBeDefined()
	})

	it('returns error when push notifications disabled', async () => {
		const app = createApp({
			capabilities: { pushNotifications: false }
		})

		// Create task
		const sendRes = await app.handle(
			jsonRpc('SendMessage', {
				message: createMessage('No push')
			})
		)
		const taskId = (await json(sendRes)).result.task.id

		const createRes = await app.handle(
			jsonRpc(
				'CreateTaskPushNotificationConfig',
				{
					taskId,
					configId: 'config-1',
					config: { url: 'https://example.com/webhook' }
				},
				'2'
			)
		)
		const body = await json(createRes)

		expect(body.error).toBeDefined()
		expect(body.error.code).toBe(-32003) // PushNotificationNotSupported
	})
})

// ============================================================================
// Custom basePath
// ============================================================================

describe('A2A Custom basePath', () => {
	it('mounts routes under custom base path', async () => {
		const app = new Elysia().use(
			a2a({
				...createDefaultOptions(),
				basePath: '/api/v1'
			})
		)

		// JSON-RPC endpoint
		const rpcRes = await app.handle(
			new Request('http://localhost/api/v1/a2a', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					jsonrpc: '2.0',
					id: '1',
					method: 'SendMessage',
					params: { message: createMessage('Custom path') }
				})
			})
		)
		expect(rpcRes.status).toBe(200)

		// REST endpoint
		const restRes = await app.handle(
			restPost('/api/v1/message/send', {
				message: createMessage('Custom REST path')
			})
		)
		expect(restRes.status).toBe(200)
	})

	it('agent card is always at well-known URL', async () => {
		const app = new Elysia().use(
			a2a({
				...createDefaultOptions(),
				basePath: '/api/v1'
			})
		)

		const res = await app.handle(req('/.well-known/agent-card.json'))
		expect(res.status).toBe(200)
	})
})

// ============================================================================
// Push Notification Config via REST
// ============================================================================

describe('A2A REST Push Notification Config', () => {
	it('CRUD push notification configs via REST', async () => {
		const store = new InMemoryTaskStore()
		const app = createApp({
			taskStore: store,
			capabilities: { pushNotifications: true },
			async onMessage() {
				return { artifacts: [], state: 'TASK_STATE_WORKING' }
			}
		})

		// Create task
		const sendRes = await app.handle(
			restPost('/message/send', {
				message: createMessage('Push REST test')
			})
		)
		const taskId = (await json(sendRes)).task.id

		// Create push config
		const createRes = await app.handle(
			restPost(`/tasks/${taskId}/pushNotificationConfigs`, {
				configId: 'cfg-1',
				config: {
					url: 'https://example.com/webhook',
					token: 'my-token'
				}
			})
		)
		expect(createRes.status).toBe(201)

		// List push configs
		const listRes = await app.handle(
			restGet(`/tasks/${taskId}/pushNotificationConfigs`)
		)
		expect(listRes.status).toBe(200)
		const listBody = await json(listRes)
		expect(listBody.configs).toBeArray()

		// Delete push config
		const deleteRes = await app.handle(
			restDelete(`/tasks/${taskId}/pushNotificationConfigs/cfg-1`)
		)
		expect(deleteRes.status).toBe(204)
	})
})
