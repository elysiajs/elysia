import { Elysia, t } from '../src'

import { Value } from '@sinclair/typebox/value'

const a = t.Union([
		t.String(),
		t.Object({
			username: t.String(),
			password: t.String()
		}),
	])

const app = new Elysia()
	.get('/hi', function ({ body }) {
		// HERE
		return 'OK?'
	})
	.post('/hi', async ({ body }) => body)
	.listen(3000, ({ hostname, port }) => {
		// console.log(`Running at http://${hostname}:${port}`)
	})
