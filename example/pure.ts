Bun.serve({
	port: 8080,
	fetch: (request: Request) => new Response('Hi'),
})

