Bun.serve({
	port: 8080,
	fetch: async (request: Request) => {
		const body = await request.text()

		return new Response('ok')
	}
})
