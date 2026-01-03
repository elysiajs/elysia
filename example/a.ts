import { Elysia, t } from '../src'
import { z } from 'zod'
import { req } from '../test/utils'

export const app = new Elysia()
	.ws('/', {
		message(a) {
			a.subscriptions
		}
	})

const a = app.fetch(req('/'))
