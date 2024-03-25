import { Elysia, t, ValidationError } from '../src'

const app = new Elysia({
	// precompile: true,
	aot: false,
})
	.get(
		'/update',
		({ cookie: { name } }) => {
			name.value = 'seminar: Himari'

			return 'a'
		},
		{
			cookie: t.Cookie(
				{
					name: t.Optional(t.String())
				},
				{
					secrets: 'a',
					sign: ['name']
				}
			)
		}
	)
	.listen(3000)

app.handle(new Request('http://localhost:3000/update'))
	.then((x) => x.headers.getSetCookie())
	.then(console.log)

// console.log(app.routes[0].composed?.toString())
