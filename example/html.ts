import { KingWorld } from '../src'

// ? Download from @kingworldjs/html
const html = (app: KingWorld) =>
	app
		.decorate(
			'html',
			(value: string) =>
				new Response(value, {
					headers: {
						'content-type': 'text/html'
					}
				})
		)
		.onAfterHandle((context, response) => {
			if (
				typeof response === 'string' &&
				response.trimStart().startsWith('<!DOCTYPE')
			)
				return context.html(response)
		})

new KingWorld()
	.use(html)
	.get(
		'/',
		() => `
		<!DOCTYPE html>
			<html>
				<head>
					<title>Hello World</title>
				</head>
				<body>
					<h1>Hello World</h1>
				</body>
			</html>`
	)
	.listen(8080)
