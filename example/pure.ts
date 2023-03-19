import {} from 'bun'

// Using navitve Bun http server
Bun.serve({
	port: 8080,
	fetch: (request: Request) => {
		return new Response('Hi')
	}
})
