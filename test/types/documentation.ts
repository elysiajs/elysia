import { Elysia, t, ValidationError } from '../../src'

// handle error property
{
	new Elysia().post(
		'/',
		{
			body: t.Object({
				name: t.String(),
				age: t.Number()
			}),
			// Built-in errors are distinguished by their classes.
			error({ error }) {
				if (error instanceof ValidationError) {
					console.log(error.all)

					const name = error.all.find(
						(x) => x.message && 'path' in x && x.path === '/name'
					)

					if (name) console.log(name)
				}
			}
		},
		({ body }) => body
	)
}
