const { Elysia } = require('../dist/cjs/index')

new Elysia()
	.get('/', ({ headers }) => headers)
	.handle(
		new Request('http://localhost/', {
			headers: {
				name: 'saltyaom'
			}
		})
	)
	.then((x) => x.text())
	.then(console.log)
