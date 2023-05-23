const cached = new Response('cached', {
	status: 200,
	headers: {
		'content-type': 'text/plain'
	}
})

Bun.serve({
	port: 3000,
	async fetch(request) {
		return cached.clone()
	}
})
