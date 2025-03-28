import { Elysia, file, t } from '../src'

const app = new Elysia()
	.post(
		'/',
		({ body }) => Bun.file('a'),
		{
			response: t.File({
				a: t.File()
			})
		}
	)
	.listen(3000)
