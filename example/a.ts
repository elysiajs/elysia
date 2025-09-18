import { Elysia, t } from '../src'

new Elysia()
	.macro({
		token: {
			resolve: () => {
				return {
					__token: '123'
				}
			}
		}
	})
	.macro('some', {
		token: true,
		beforeHandle: ({ __token }) => {
			console.log('__token', __token)
		}
	})
