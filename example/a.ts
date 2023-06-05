import { Elysia, t } from '../src'
import { html } from '@elysiajs/html'

const a = (app: Elysia) =>
	app
		.onAfterHandle(() => {
			console.log(0)
		})
		.post(
			'/',
			() => {
				try {
					throw new Error('A')

					return {
						success: true,
						message: 'Created'
					}
				} catch (error) {
					return {
						success: false,
						message: 'Created'
					}
				}
			},
			{
				afterHandle(a, response) {
					console.log('1')
					console.log(response)
				},
				detail: {
					summary: 'A',
					description: 'B',
					tags: ['ser', 'dawd']
				},
				body: t.Object({
					username: t.String()
				}),
				response: t.Object({
					success: t.Boolean(),
					message: t.Optional(t.String())
				}),
				error(response) {
					switch (response.code) {
						case 'VALIDATION':
							console.log({
								value: response.error.value
							})

							break
					}
				}
			}
		)

const app = new Elysia().use(html()).use(a).listen(3000)
