import { Elysia, error, t } from '../src'

export const App = new Elysia()
	.get('/', () => {
		return 'Hi everyone'
	})
	.post(
		'/a',
		async ({ body: { images } }) => {
			console.log('images', images)
			if (images.length < 10) {
				throw new Error("it shouldn't come here.")
			}
			return images
		},
		{
			body: t.Object({
				images: t.Files({
					type: ['image/png'],
					minItems: 3,
					maxItems: 15,
					maxSize: '3m',
					minSize: '600k'
				})
			})
		}
	)
	.listen(3000)
