import { Elysia } from '../src'

const server = 'https://lotto.api.rayriffy.com/'

const app = new Elysia()
	.all(
		'/*',
		async ({ params, request }) =>
			fetch(server + params['*'], {
				...request
			}),
		{
			type: 'none'
		}
	)
	.listen(3000)
