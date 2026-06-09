const sleep = (time: number) => new Promise(resolve => setTimeout(resolve, time))

Bun.serve({
	port: 3000,
	fetch: async () => {
		await sleep(1000)

		return new Response('Hi')
	}
})
