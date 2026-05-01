import { Elysia, t } from '../src/2'
import * as z from 'zod'

const app = new Elysia()
	.get('/', () => 'ok', {
		query: z.object({
			name: z.string()
		})
	})
	.listen(3000)

app.handle('/')
	.then((x) => x.text())
	.then(console.log)
