import { Elysia } from '../src'

const app = new Elysia()
	.trace(async ({ error }) => {
	})
	.get(
		'/',
		() => {
			throw new Error('A')
		},
		{
			error: [
				function a({ set }) {
					set.status = "I'm a teapot"
					return 'B'
				},
				function b() {}
			]
		}
	)
	.listen(3000)
