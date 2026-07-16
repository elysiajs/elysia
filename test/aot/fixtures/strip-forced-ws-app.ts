import { Elysia } from '../../../src'

// A WebSocket-only app keeps its runtime while the handler compiler is stripped.
export const app = new Elysia().ws('/ws', { message: () => {} })
