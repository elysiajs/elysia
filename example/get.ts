import { Elysia, SCHEMA, t } from '../src'

const app = new Elysia()
	.get('/part', () => 'Part')
	.options('*', () => 'Hi')
	.listen(8080)

console.log(
	await app.handle(
		new Request('/part', {
			method: 'OPTIONS'
		})
	)
)
