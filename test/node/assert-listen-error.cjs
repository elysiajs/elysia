module.exports = (Elysia, format) => {
	let error
	try {
		new Elysia().listen(0)
	} catch (cause) {
		error = cause
	}

	if (
		!error?.message.includes(
			'[Elysia] listen() requires an adapter on Node.js'
		) ||
		!error.message.includes('https://elysiajs.com/integrations/node')
	)
		throw new Error(
			`❌ ${format} Node.js listen() message: ${error?.message ?? 'did not throw'}`
		)

	console.log(`✅ ${format} Node.js listen() names the runtime`)
}
