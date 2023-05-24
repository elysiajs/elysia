Bun.serve({
	port: 3000,
	fetch: (request) => {
		throw new Error('A')
	},
	error(request) {
		return new Response('error')
	}
})
