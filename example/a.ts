import Elysia, { NotFoundError, t } from '../src'
import { req } from '../test/utils'

const app = new Elysia()
	.ws('/', {
		message() {
			return 'Hello, WebSocket!'
		}
	})
	.listen(3000)
