import { Elysia, redirect, t } from '../src'
import { mapResponse } from '../src/adapter/web-standard/handler'

const app = new Elysia()

const a = new Elysia()
	.get('/id/:id', ({ params }) => 'a', {
		params: t.Object({
			id: t.Number()
		})
	})
	.listen(3000)
