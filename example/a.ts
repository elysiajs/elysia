import { Elysia, t } from '../src'
import { z } from 'zod'
import { req } from '../test/utils'

export const app = new Elysia()
	.ws('/', {
		open(ws) {
			ws.subscribe('a')
		},
		message(a) {
			console.log(a.subscriptions)
		}
	})
	.listen(3000)
