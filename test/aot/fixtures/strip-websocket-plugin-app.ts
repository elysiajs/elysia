import { Elysia } from '../../../src'
import { websocket } from '../../../src/plugin/websocket'

// The WebSocket capability is registered but no `.ws()` route exists, so the WS route builder is stripped.
export const app = new Elysia().use(websocket()).get('/', 'hi')
