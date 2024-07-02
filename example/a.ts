import { Elysia, replaceSchemaType, t } from '../src'
import { TypeCompiler } from '../src/type-system'
import { req } from '../test/utils'

console.log(
	replaceSchemaType(t.String(), {
		from: t.String(),
		to: () => t.Number()
	})
)
