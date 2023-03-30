// Using navitve Bun http server
Bun.serve({
	port: 8080,
	fetch: (request: Request) => {
		const hasBody = !!request.body ? true : false

		return new Response(hasBody.toString())
	}
})
