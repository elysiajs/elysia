import { Elysia } from '../../../src'
import { websocket } from '../../../src/plugin/websocket'

export default new Elysia().use(websocket()).ws('/ws', { message: () => {} })
