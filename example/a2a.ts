/**
 * A2A Protocol Example
 *
 * This example demonstrates how to create an A2A-compliant agent
 * using ElysiaJS with both synchronous and streaming message handling.
 *
 * Run: bun run example/a2a.ts
 *
 * Endpoints:
 *   GET  /.well-known/agent-card.json   - Agent Card discovery
 *   POST /a2a                           - JSON-RPC 2.0 endpoint
 *   POST /message/send                  - Send message (REST)
 *   POST /message/stream                - Send streaming message (REST, SSE)
 *   GET  /tasks/:id                     - Get task (REST)
 *   GET  /tasks                         - List tasks (REST)
 *   POST /tasks/:id/cancel              - Cancel task (REST)
 *   POST /tasks/:id/subscribe           - Subscribe to task (REST, SSE)
 *
 * Test with curl:
 *   # Discover agent
 *   curl http://localhost:3000/.well-known/agent-card.json | jq
 *
 *   # Send message via JSON-RPC
 *   curl -X POST http://localhost:3000/a2a \
 *     -H 'Content-Type: application/json' \
 *     -d '{
 *       "jsonrpc": "2.0",
 *       "id": "1",
 *       "method": "SendMessage",
 *       "params": {
 *         "message": {
 *           "messageId": "msg-001",
 *           "role": "ROLE_USER",
 *           "parts": [{ "text": "What is the capital of France?" }]
 *         }
 *       }
 *     }'
 *
 *   # Send message via REST
 *   curl -X POST http://localhost:3000/message/send \
 *     -H 'Content-Type: application/json' \
 *     -d '{
 *       "message": {
 *         "messageId": "msg-002",
 *         "role": "ROLE_USER",
 *         "parts": [{ "text": "Tell me a joke" }]
 *       }
 *     }'
 *
 *   # Stream message via REST (SSE)
 *   curl -X POST http://localhost:3000/message/stream \
 *     -H 'Content-Type: application/json' \
 *     -d '{
 *       "message": {
 *         "messageId": "msg-003",
 *         "role": "ROLE_USER",
 *         "parts": [{ "text": "Count from 1 to 5" }]
 *       }
 *     }'
 *
 *   # Stream via JSON-RPC
 *   curl -X POST http://localhost:3000/a2a \
 *     -H 'Content-Type: application/json' \
 *     -d '{
 *       "jsonrpc": "2.0",
 *       "id": "2",
 *       "method": "SendStreamingMessage",
 *       "params": {
 *         "message": {
 *           "messageId": "msg-004",
 *           "role": "ROLE_USER",
 *           "parts": [{ "text": "Stream me a story" }]
 *         }
 *       }
 *     }'
 */

import { Elysia } from '../src'
import { a2a } from '../src/a2a'
import type { A2AHandlerContext, A2AStreamEvent } from '../src/a2a'

const app = new Elysia()
	.use(
		a2a({
			agent: {
				name: 'Elysia Demo Agent',
				description:
					'A demo A2A agent built with ElysiaJS showing both sync and streaming responses',
				version: '1.0.0',
				provider: {
					organization: 'ElysiaJS',
					url: 'https://elysiajs.com'
				},
				skills: [
					{
						id: 'echo',
						name: 'Echo',
						description:
							'Echoes back the user message with a greeting',
						tags: ['demo', 'echo']
					},
					{
						id: 'counter',
						name: 'Counter',
						description: 'Counts numbers with streaming output',
						tags: ['demo', 'streaming']
					}
				],
				defaultInputModes: ['text/plain'],
				defaultOutputModes: ['text/plain']
			},

			capabilities: {
				streaming: true,
				pushNotifications: false
			},

			// Synchronous message handler
			async onMessage(ctx: A2AHandlerContext) {
				const userText = ctx.message.parts
					.filter((p) => p.text)
					.map((p) => p.text)
					.join(' ')

				console.log(`[A2A] Received message: ${userText}`)

				return {
					artifacts: [
						{
							artifactId: crypto.randomUUID(),
							name: 'response',
							parts: [
								{
									text: `Hello! You said: "${userText}". I'm an A2A-compliant agent running on ElysiaJS.`
								}
							]
						}
					],
					state: 'TASK_STATE_COMPLETED'
				}
			},

			// Streaming message handler
			async *onStreamMessage(
				ctx: A2AHandlerContext
			): AsyncGenerator<A2AStreamEvent, void, unknown> {
				const userText = ctx.message.parts
					.filter((p) => p.text)
					.map((p) => p.text)
					.join(' ')

				console.log(`[A2A] Streaming message: ${userText}`)

				// Signal that we're working
				yield {
					type: 'status',
					state: 'TASK_STATE_WORKING',
					message: {
						parts: [{ text: 'Processing your request...' }]
					}
				}

				// Simulate chunked processing
				const chunks = [
					'Once upon a time, ',
					'in a land of fast servers, ',
					'there lived an agent ',
					'built with ElysiaJS. ',
					'The end!'
				]

				const artifactId = crypto.randomUUID()

				for (let i = 0; i < chunks.length; i++) {
					// Simulate processing delay
					await new Promise((r) => setTimeout(r, 500))

					yield {
						type: 'artifact',
						artifact: {
							artifactId,
							name: 'story',
							parts: [{ text: chunks[i] }]
						},
						append: i > 0,
						lastChunk: i === chunks.length - 1
					}
				}

				// Signal completion
				yield {
					type: 'status',
					state: 'TASK_STATE_COMPLETED',
					message: {
						parts: [{ text: 'Story complete!' }]
					}
				}
			},

			// Task cancellation handler
			async onCancelTask(taskId: string) {
				console.log(`[A2A] Cancellation requested for task: ${taskId}`)
				return true
			}
		})
	)
	.listen(3000)

console.log(`
🤖 A2A Demo Agent is running!
   Server:     http://localhost:3000
   Agent Card: http://localhost:3000/.well-known/agent-card.json
   JSON-RPC:   POST http://localhost:3000/a2a
   REST Send:  POST http://localhost:3000/message/send
   REST Stream: POST http://localhost:3000/message/stream
`)
