import { Elysia, t, prefix } from '../src'
import { t as t2 } from '../dist'
import { Validator } from '../src/validator'

const app = new Elysia().mapResponse(() => new Response('q')).get('/', 'a')

app.handle('/')
	.then((res) => res.text())
	.then(console.log)
