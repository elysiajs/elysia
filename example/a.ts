import { Elysia, replaceSchemaType, t } from '../src'
import { TypeCompiler } from '../src/type-system'
import { req } from '../test/utils'

new Elysia().model('a', t.String()).model((x) => ({
	...x,
	b: x.a
}))

console.log(
	replaceSchemaType(t.String(), {
		from: t.String(),
		to: () => t.Number()
	})
)
