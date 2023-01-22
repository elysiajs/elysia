Bun.serve({
	port: 8080,
	async fetch(req) {
		console.log("Got")
		console.log(req.headers.toJSON())

		try {
			return new Response(await req.text())
		} catch (error) {
			return new Response('')
		}
	}
})
