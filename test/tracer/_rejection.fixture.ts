// Isolate process-level rejection events from the test runner.

import { Elysia } from '../../src'
import { trace } from '../../src/plugin/trace'

process.on('unhandledRejection', (reason) => {
	console.log(`UNHANDLED ${String(reason)}`)
	process.exitCode = 1
})
process.on('uncaughtException', (error) => {
	console.log(`UNCAUGHT ${String(error)}`)
	process.exitCode = 1
})

// Keep trace errors in the ordered fixture report.
let errors = 0
console.error = (...args: unknown[]) => {
	errors++
	console.log(`TRACE-ERROR ${String(args[0])}`)
}

const shape = process.env.TRACE_SHAPE ?? 'listener'
const boom = async () => {
	throw new Error('trace boom')
}

const app = new Elysia().use(trace()).trace(({ onHandle, onAfterResponse }) => {
	if (shape === 'onHandle') onHandle(boom)
	else if (shape === 'onAfterResponse') onAfterResponse(boom)

	if (shape === 'listener') return boom()
})

app.get('/', () => 'ok')

await app.modules
;(app as any).compile()

const response = await app.handle(new Request('http://localhost/'))
const body = await response.text()

await Bun.sleep(60)

console.log(JSON.stringify({ status: response.status, body, errors }))
