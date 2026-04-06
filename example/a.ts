import { coerce } from '../src/schema/coerce'
import { hasType } from '../src/schema/utils'
import { ELYSIA_TYPES, t } from '../src/type'

const schema = t.Object({
	hello: t.String(),
	b: t.Object({
		a: t.Numeric()
	})
})

console.dir(schema, {
	depth: null
})

const q = coerce(schema, [['String', () => t.Number()]])

console.dir(q, {
	depth: null
})

console.log(hasType(ELYSIA_TYPES.File, schema))
