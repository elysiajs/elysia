import { Elysia, t } from '../src'

const api = new Elysia()
	.get('/:id', ({ params }) => params, {
		params: t.Object({
			id: t.String()
		})
	})
	.listen(3000)

const result = await api
	.handle(new Request('http://localhost:3000/hello world'))
	.then((response) => response.json())
console.log('🚀 ~ result:', result)
