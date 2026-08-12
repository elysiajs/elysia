Bun.serve({
	port: 3000,
	tls: {},
	http3: true,
	fetch: (request) => new Response('Hi')
})
