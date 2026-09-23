import { t } from '../src'
import { Elysia } from '../src/base'

new Elysia()
	.error(({ error }) => {
		console.log(error)
	})
	.get('/', ({ status }) => {
		throw status(418)
	})
	.handle('/')
	.then((x) => x.text())
	.then(console.log)
