import { Elysia, t } from '../src/2'
import * as z from 'zod'

const app = new Elysia()
	.derive(({ status }) => {
		return status(418)
	})
	.get('/', () => 'hi')

console.log(app.handler(0, true).toString())

app.handle('/')
	.then((x) => x.text())
	.then(console.log)
