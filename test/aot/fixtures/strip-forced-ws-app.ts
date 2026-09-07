import { Elysia } from '../../../src'
import { websocket } from '../../../src/plugin/websocket'

// A WebSocket-only app keeps its runtime while the handler compiler is stripped.
export const app = new Elysia().use(websocket()).ws('/ws', { message: () => {} })
