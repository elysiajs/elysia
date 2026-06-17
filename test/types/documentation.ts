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
			// `error.code` was removed — dispatch on the error class with `instanceof`
			error({ error }) {
				if (error instanceof ValidationError) {
					console.log(error.all)

					// Find a specific error name (path is OpenAPI Schema compliance)
					const name = error.all.find(
						(x) => x.message && 'path' in x && x.path === '/name'
					)

					// If there is a validation error, then log it
					if (name) console.log(name)
				}
			}
		},
		({ body }) => body
	)
}
