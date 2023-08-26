import { Elysia, t, Context } from '../src'

const app = new Elysia().group('/course', (app) =>
	app
		.get('', () => '')
		.put('/new', () => '')
		.group(
			'/id/:courseId',
			{
				params: t.Object({
					courseId: t.Numeric()
				})
			},
			(app) =>
				app
					// .get('', ({ params: { courseId } }) => courseId)
					// .patch('', () => '')
					.group('/chapter', (app) =>
						app.get('/hello', ({ params: { courseId } }) => '')
					)
		)
)

type App = typeof app
type B = keyof App['meta']['schema']
