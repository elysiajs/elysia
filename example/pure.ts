// @ts-ignore
console.log(caches)

export default {
	port: 8080,
	fetch: (request: Request) => new Response('Hi')
}
