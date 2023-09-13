import { TypeCompiler } from '@sinclair/typebox/compiler'
import { Elysia, t } from '../src'
import { hasTransform, hasType } from '../src/compose'

new Elysia()
	.post('/', ({ body: { file } }) => file.size, {
		body: t.Object({
			file: t.File()
		})
	})
	.listen(3000)
