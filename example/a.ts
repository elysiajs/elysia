import { KingWorld, t } from '../src'

const typed = (app: KingWorld) =>
	app.schema({
		response: t.Number()
	})

new KingWorld()
	.use(typed)
	.schema({
		response: t.String(),
	})
	.get('/', () => 'fine')
	.get('/hello', () => 1, {
		schema: {
			response: t.Number()
		},
	})
	.listen(3000)
