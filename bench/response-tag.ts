// Plan 004: typeof fast path in responseTag (src/adapter/web-standard/handler.ts)
//
// Full round-trip app.handle(new Request(...)) loop, 200k iterations,
// 20k warmup, best-of-3 runs of the script (best ns/op reported per run).
// Bun (JavaScriptCore), measured 2026-07-23.
//
// BEFORE (baseline, responseTag via Object.getPrototypeOf):
//   string route: 350.2 ns/op (best of 350.2 / 351.2 / 353.9)
//   object route: 544.3 ns/op (best of 550.1 / 551.5 / 544.3)
//   number route: 406.6 ns/op (best of 413.7 / 411.2 / 406.6)
//
// AFTER (typeof fast path — REJECTED, see below):
//   string route: 356.5 ns/op (best of 358.9 / 356.5 / 359.4) → -1.80%
//   object route: 551.3 ns/op (best of 555.8 / 551.3 / 561.7) → -1.29%
//   number route: 410.4 ns/op (best of 414.6 / 410.4 / 422.1) → -0.93%
//
// GATE OUTCOME: REJECTED. All three scenarios regressed slightly instead of
// improving (gate required string >=2% improvement or revert). JSC/Bun
// already handles primitive->wrapper Object.getPrototypeOf cheaply here;
// the added typeof branches purely added overhead on the common path
// (every response, including objects/arrays, now pays 3 extra typeof
// checks before falling through to the proto lookup). Change reverted;
// src/adapter/web-standard/handler.ts is unmodified from 881e3458.

import { Elysia } from '../src'

const ITERATIONS = 200_000
const WARMUP = 20_000
const RUNS = 5

const string = new Elysia().get('/', () => 'hello world')
const object = new Elysia().get('/', () => ({ hello: 'world', n: 1 }))
const number = new Elysia().get('/', () => 42)

async function run(app: Elysia, iterations: number) {
	for (let i = 0; i < iterations; i++)
		await app.handle(new Request('http://localhost/'))
}

async function bestOf(app: Elysia, label: string) {
	await run(app, WARMUP)

	let best = Infinity
	for (let i = 0; i < RUNS; i++) {
		const start = performance.now()
		await run(app, ITERATIONS)
		const elapsed = performance.now() - start
		const nsPerOp = (elapsed * 1_000_000) / ITERATIONS
		if (nsPerOp < best) best = nsPerOp
	}

	console.log(`${label}: ${best.toFixed(1)} ns/op`)
}

await bestOf(string, 'string route')
await bestOf(object, 'object route')
await bestOf(number, 'number route')
