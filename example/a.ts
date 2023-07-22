import { Elysia, t } from '../src'

const app = new Elysia()
	.get('/test/:id/:id2/:id3', ({ params }) => params, {
		params: t.Object({
			id: t.Numeric(),
			id2: t.Optional(t.Numeric()),
			id3: t.String()
		})
	})
	.listen(3000)
