import { Elysia, t } from '../src'
import { TypeCompiler } from '../src/type-system'
import { createMirror } from 'exact-mirror'
import z from 'zod'
import { req } from '../test/utils'

const SchemaA = t.Object({ foo: t.Number() })
const SchemaB = t.Object({ foo: t.Number(), baz: t.Boolean() })
const UnionSchema = t.Union([SchemaA, SchemaB])
const OmittedUnionSchema = t.Omit(UnionSchema, ['baz'])

const app = new Elysia()
	.get('/', () => ({ baz: true, foo: 1 }), {
		response: OmittedUnionSchema
	})
	.compile()

console.dir(OmittedUnionSchema, {
	depth: null
})

app.handle(req('/'))
	.then((x) => x.status)
	.then(console.log)

console.dir(OmittedUnionSchema, {
	depth: null
})

const mirror = createMirror(OmittedUnionSchema, {
	TypeCompiler: TypeCompiler
})

const value = mirror({
	baz: true,
	foo: 1
})

console.log(value)

// console.dir(app.routes[0].hooks.response, {
// 	depth: null
// })
