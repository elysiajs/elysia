// Using navitve Bun http server
Bun.serve({
	serverName: 'Elysia',
	port: 8080,
	async fetch(request) {
		return 'a'
	}
})
