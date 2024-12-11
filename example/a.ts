import { Elysia, t } from '../src'

const app = new Elysia()
	.onParse('custom', ({ contentType, request }) => {
		if (contentType.startsWith('application/x-elysia-1'))
			return { name: 'Eden' }
	})
	.onParse('custom2', ({ contentType, request }) => {
		if (contentType.startsWith('application/x-elysia-2'))
			return { name: 'Pardofelis' }
	})
	.post('/json', ({ body }) => body, {
		parse: ['custom']
	})

const response = await Promise.all([
	app
		.handle(
			new Request('http://localhost:3000/json', {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({ name: 'Aru' })
			})
		)
		.then((x) => x.json()),
	app
		.handle(
			new Request('http://localhost:3000/json', {
				method: 'POST',
				headers: {
					'content-type': 'application/x-elysia-1'
				},
				body: JSON.stringify({ name: 'Aru' })
			})
		)
		.then((x) => x.text()),
	app
		.handle(
			new Request('http://localhost:3000/json', {
				method: 'POST',
				headers: {
					'content-type': 'application/x-elysia-2'
				},
				body: JSON.stringify({ name: 'Aru' })
			})
		)
		.then((x) => x.text())
])

console.log(response)
