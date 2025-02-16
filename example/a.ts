import { Elysia, t } from '../src'

const PATH = '/y a y'

const app = new Elysia({ precompile: true })
	.post('/a', ({ body: { image } }) => image, {
		parse: 'formdata',
		body: t.Object({
			image: t.File({ maxSize: 10000000, type: 'image/*' })
		}),
		transform({ body }) {
			console.log({ body })
		}
	})
	.listen(3000)

// console.log(response.status)
// console.log(await response.text())

// expect(response.status).toBe(200)
// expect(await response.text()).toBe('1')
