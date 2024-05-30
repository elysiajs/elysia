import { Type, Static, StaticDecode, StaticEncode } from '@sinclair/typebox'

<<<<<<< HEAD
const T = Type.Array(Type.Number(), { uniqueItems: true })

// const T = Type.Transform(Type.Array(Type.Number(), { uniqueItems: true }))         
//   .Decode(value => new Set(value))
//   .Encode(value => [...value])

type D = StaticDecode<typeof T>   
=======
const group = new Elysia({ prefix: '/group' })
	.get('/start', ({ cookie: { name } }) => {
		name.value = 'hello'

		return 'hello'
	})
	.get('/end', ({ cookie: { name } }) => {
		name.remove()

		return 'hello'
	})

const app = new Elysia({
	precompile: true,
	cookie: {
		path: '/'
	}
})
	.use(group)
	.listen(3000)

// console.log(app.routes[0].composed?.toString())
>>>>>>> main
