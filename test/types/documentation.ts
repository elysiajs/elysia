import { Elysia, t } from '../../src'

// handle error property
{
	new Elysia()
		.post('/', ({ body }) => body, {
			body: t.Object({
				name: t.String(),
				age: t.Number()
			}),
			error({ code, error }) {
				switch (code) {
					case 'VALIDATION':
						console.log(error.all)

						// Find a specific error name (path is OpenAPI Schema compliance)
						const name = error.all.find(
							(x) => x.summary && 'path' in x && x.path === '/name'
						)

						// If there is a validation error, then log it
						if (name) console.log(name)
				}
			}
		})
}
