Bun.serve({
	port: 8080,
	fetch: () => {
		const headers = new Headers()
		headers.append('date', new Date().toUTCString())
		headers.append('Content-Type', 'text/plain')

		return new Response('ok', {
			headers
		})
	}
})
