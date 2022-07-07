export default {
    port: 8080,
    fetch: async (request: Request) => {
        console.log(await request.text())

        return new Response('Hi')
    }
}
