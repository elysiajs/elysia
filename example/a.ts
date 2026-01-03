import { Elysia, t } from '../src'
import { z } from 'zod'
import { req } from '../test/utils'

export const app = new Elysia()
	.ws('/', {
		message(a) {
			a.subscriptions
		}
	})

Bun.serve({
	fetch() {},
	websocket: {
		message(a) {
			a.subscriptions
		}
	}
})
