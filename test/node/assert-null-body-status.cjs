// Node's Response (undici) throws on a body with a null-body status where Bun
// drops it: `set.status = 204` + a returned value must still answer 204
module.exports = async (Elysia, status, format) => {
	const app = new Elysia()
		.get('/204', ({ set }) => {
			set.status = 204
			return 'ignored'
		})
		.get('/304', ({ set }) => {
			set.status = 304
			return { ignored: true }
		})
		.get('/override', ({ set }) => {
			set.status = 204
			return status(200, 'kept')
		})

	for (const [path, expected, body] of [
		['/204', 204, ''],
		['/304', 304, ''],
		['/override', 200, 'kept']
	]) {
		const response = await app.handle(new Request(`http://localhost${path}`))
		const text = await response.text()

		if (response.status !== expected || text !== body)
			throw new Error(
				`❌ ${format} Node.js ${path} answered ${response.status} ${JSON.stringify(text)}`
			)
	}

	console.log(`✅ ${format} Node.js null-body statuses drop the body`)
}
