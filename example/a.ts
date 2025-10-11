import { Elysia, sse } from '../src'

const app = new Elysia()
	.get(
		'/handler',
		({ status }) => {
			return status(401, 'unauthorized handler')
		},
		{
			afterHandle: ({ responseValue, response }) => {
				console.log('afterHandle', { responseValue, response })
			},
			beforeHandle: ({ status }) => {
				return status(401, 'unauthorized beforeHandle')
			},
			afterResponse: ({ responseValue, response }) => {
				console.log('afterResponse', { responseValue, response })
			}
		}
	)
	.listen(3000)

// console.log(app.routes[0].compile().toString())
