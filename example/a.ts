import { Elysia, t } from '../src'

const app = new Elysia()
	.get(
		'/',
		({ cookie: { session } }) => {
			return 'hi'
		},
		{
			beforeHandle({}) {
				console.log('HI')
			}
		}
	)
	.listen(3000)

console.log(app.routes[0].composed?.toString())
