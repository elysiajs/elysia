import { Type } from '@sinclair/typebox'
import { TypeCompiler } from '@sinclair/typebox/compiler'

const numeric = Type.Transform(Type.String())
	.Decode((v) => +v)
	.Encode((v) => v + '')

const inline = TypeCompiler.Compile(numeric)
// console.log(typeof inline.Decode('1')) // number

console.log(inline.Check(1)) // true

const Module = Type.Module({
	numeric
})

const importedNumeric = Module.Import('numeric')
const imported = TypeCompiler.Compile(importedNumeric)

// console.log(typeof imported.Decode('1')) // string

console.log(imported.Check(1)) // true

// const app = new Elysia({ precompile: true })
// 	.model({
// 		myModel: t.Object({ num: t.Number() })
// 	})
// 	.get(
// 		'/',
// 		({ query: { num } }) => {
// 			console.log({ num })
// 			return { num }
// 		},
// 		{
// 			query: 'myModel'
// 		}
// 	)
// 	.compile()

// app.handle(req('/?num=1'))
// 	.then((x) => x.json())
// 	.then(console.log)

// console.log(app.routes[0].composed?.toString())

// console.log(
// 	`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
// )
