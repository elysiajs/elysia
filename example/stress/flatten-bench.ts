import { Elysia } from '../../src'
import { profile } from './utils'

const depth = 1_000
const app = new Elysia()

for (let i = 0; i < depth; i++) app.beforeHandle('global', function fn() {})

app.get('/r', () => 'ok')

// Force compile-and-call cycle to exercise flattenChain.
// Each handle() call hits the cached compiled path after first invocation,
// but if we make many fresh apps we exercise compile (which calls
// flattenChain on appHook) per app.
const iters = 1_000

const stop = profile(`flattenChain x${iters} (depth=${depth})`)

for (let i = 0; i < iters; i++) {
	const app = new Elysia()
	for (let j = 0; j < 100; j++) app.beforeHandle('global', function fn() {})
	app.get('/r', () => 'ok')

	// Trigger compile via routes getter (flattens appHook chain).
	void app.routes
}

stop()
