const assert = require('node:assert/strict')

module.exports = async (Elysia, trace, format) => {
	const unhandled = []
	const onUnhandled = (error) => unhandled.push(error)
	process.on('unhandledRejection', onUnhandled)
	try {
		for (const fail of [false, true]) {
			const failure = new Error('traced failure')
			const checks = []
			const stops = { handle: [], before: [], child: [] }
			let handled = 0
			let began
			const watch = (phase, detail) => {
				checks.push({ phase, begin: detail.begin, pending: Promise.all([detail.end, detail.error]) })
				detail.onStop(({ error }) => { stops[phase].push(error) })
			}
			const app = new Elysia()
				.use(trace())
				.trace(({ onHandle, onBeforeHandle }) => {
					began = onHandle((detail) => watch('handle', detail))
					onBeforeHandle((detail) => {
						watch('before', detail)
						detail.onEvent((child) => watch('child', child))
					})
				})
				.beforeHandle(() => {})
				.get('/', () => {
					handled++
					if (fail) throw failure
					return 'ok'
				})
			const response = await app.handle(new Request('http://localhost/'))
			assert.equal(response.status, fail ? 500 : 200)
			const body = await response.text()
			if (!fail) assert.equal(body, 'ok')
			assert.equal(handled, 1)
			assert.equal((await began).event, 'handle')
			assert.equal(checks.length, 3)
			for (const check of checks) {
				const [end, error] = await check.pending
				const expected = fail && check.phase === 'handle' ? failure : null
				assert.ok(Number.isFinite(end) && end >= check.begin)
				assert.equal(error, expected)
				assert.deepEqual(stops[check.phase], [expected])
			}
		}
		await new Promise(setImmediate)
		assert.deepEqual(unhandled, [])
	} finally {
		process.off('unhandledRejection', onUnhandled)
	}
	console.log(`✅ ${format} Node.js trace settles parent and child lifecycles`)
}
