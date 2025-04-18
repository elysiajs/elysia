import { Elysia, t } from '../src'

const app = new Elysia({ precompile: true })
	.post('/', ({ body: { file } }) => file?.size ?? 'no file', {
		body: t.Object({
			file: t.Optional(
				t.File({
					type: 'application/pdf'
				})
			)
		})
	})
	.listen(3000)
