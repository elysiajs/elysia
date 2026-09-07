import { Elysia, t } from '../../../src'
import { websocket } from '../../../src/plugin/websocket'

// The WS upgrade path parses, verifies and validates cookies without going
// through the handler JIT, so it emits no `cc` alias — cookie support must
// still be kept out of the strip set.
export const app = new Elysia()
	.use(websocket())
	.get('/', () => 'ok')
	.ws('/ws', {
		cookie: t.Cookie({ token: t.String() }),
		message: () => {}
	})
