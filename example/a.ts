import { Elysia, error, t } from '../src'
import { findAlias, inferBodyReference, removeDefaultParameter } from '../src/sucrose'
import { post, req } from '../test/utils'

const parameter = 'a = 1, b = 2, c = 3'
const result = removeDefaultParameter(parameter)
console.log(result)

// const plugin = new Elysia()
// .macro((app) => {
//     return {
//         auth() {
//             return {

//             }
//         }
//     }
// })

const app = new Elysia({ precompile: true })
	.get('/id/:id', ({ set, params: { id }, query: { name } }) => {
		set.headers['x-powered-by'] = 'Elysia'

		return id + ' ' + name
	})
	.compile()

// app.compile()

// console.log(app.fetch.toString())
// console.log(app.router.history[0].composed?.toString())
