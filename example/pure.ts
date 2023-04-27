// // Using navitve Bun http server
Bun.serve({
	port: 8080,
	fetch: async (request) => {
		if (request.body) return new Response(JSON.stringify(await request.json()))

		return new Response('w/o body')
	}
})
