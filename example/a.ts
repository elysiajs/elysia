// server.ts
import { Elysia, InternalServerError, t } from '../src'

class CustomError extends Error {}

const app = new Elysia({ aot: false })
	.onAfterResponse((context) => {
		console.log(context.query)
	})
	.post('/', () => 'yay', {
		body: t.Object({
			test: t.String()
		})
	})
	.get('/customError', () => {
		throw new CustomError('whelp')
	})
	.get('/internalError', () => {
		throw new InternalServerError('whelp')
	})
	.listen(3000)

console.log(app.server!.url.toString())

// client.ts
export const newReq = (params?: {
	path?: string
	headers?: Record<string, string>
	method?: string
	body?: string
	query: string
}) =>
	new Request(
		`http://localhost:3000${params?.path ?? '/'}?name=${params?.query}`,
		params
	)

const cases = [
	['NotFoundError', newReq({ path: '/notFound', query: 'NotFoundError' })],
	[
		'ParseError',
		newReq({
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: '',
			query: 'ParseError'
		})
	],
	[
		'ValidationError',
		newReq({
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({}),
			query: 'ValidationError'
		})
	],
	['CustomError', newReq({ path: '/customError', query: 'CustomError' })],
	[
		'InternalServerError',
		newReq({ path: '/internalError', query: 'InternalServerError' })
	]
] as const

for (const [name, req] of cases) {
	console.log("N", name)
	await fetch(req)
}
