import { Elysia, t } from 'elysia'
import * as adapterUtils from 'elysia/adapter/utils'
import * as compiled from 'elysia/compiled'

if ('Bun' in globalThis) {
	throw new Error('❌ Use Node.js to run this test!')
}

setTimeout(() => {
	console.log('❌ ESM Node.js timed out')
	process.exit(1)
}, 5000)

if (
	typeof adapterUtils.createResponseHandler !== 'function' ||
	typeof adapterUtils.createStreamHandler !== 'function'
) {
	throw new Error('❌ ESM Node.js adapter/utils subpath failed')
}

if (!('validators' in compiled) || !('handlers' in compiled)) {
	throw new Error('❌ ESM Node.js compiled subpath failed')
}

const app = new Elysia().get(
	'/',
	{
		response: t.String()
	},
	() => 'Node.js'
)

const response = await app.handle(new Request('http://localhost'))

if ((await response.text()) !== 'Node.js') {
	throw new Error('❌ ESM Node.js failed')
}

// A plain-string response on the non-Bun adapter must carry content-type
// text/plain (regression guard — a `type` typo previously shipped a bogus
// header here, and the Bun-run test suite cannot exercise this path).
const ct = response.headers.get('content-type')
if (!ct || !ct.startsWith('text/plain')) {
	throw new Error(
		`❌ ESM Node.js: expected content-type text/plain, got ${ct}`
	)
}

console.log('✅ ESM Node.js works!')

process.exit()
