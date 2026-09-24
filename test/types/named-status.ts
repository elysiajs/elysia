import { Elysia, t } from '../../src'

// A handler may return a status by name when the response map declares
// its numeric code, exactly as it may return it by number
{
	new Elysia()
		.get(
			'/named',
			{ response: { 200: t.String(), 404: t.String() } },
			({ status }) =>
				Math.random() > 0.5 ? status('Not Found', 'missing') : 'ok'
		)
		.get(
			'/numeric',
			{ response: { 200: t.String(), 404: t.String() } },
			({ status }) => (Math.random() > 0.5 ? status(404, 'missing') : 'ok')
		)
}

// The name must still map to a declared code with a matching body
{
	new Elysia().get(
		'/undeclared',
		{ response: { 200: t.String() } },
		// @ts-expect-error 404 is not declared
		({ status }) => status('Not Found', 'missing')
	)

	new Elysia().get(
		'/wrong-body',
		{ response: { 200: t.String(), 404: t.String() } },
		// @ts-expect-error 404 body must be a string
		({ status }) => status('Not Found', 1)
	)
}
