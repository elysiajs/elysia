// Plan 008: msg/s throughput for the WS sync-dispatch echo lane.
//
// One connection, 20k small string messages, each awaited round-trip
// (send -> server echoes -> client receives) before the next is sent.
// Best-of-5 after 1 warmup run. Ratios matter more than absolutes.
//
// REJECTED BY GATE — the `dispatchMessageSync` per-frame `Object.create`
// skip (reuse `connection` directly when the handler never touches `body`)
// was tried and reverted. Two independent findings, both against the
// method-shorthand handler style used below (matching the plan's own
// example and the idiomatic style used throughout this repo's WS tests):
//
//   1. The pre-existing `handlerMayTouchBody` heuristic (route.ts, out of
//      scope for this plan) has a bug: for named functions / object-method
//      shorthand (`{ message(ws, msg) {...} }`), the check
//      `source.slice(0, paramsEnd).indexOf('(', 1) !== -1` always refinds
//      the handler's own opening paren, so `messageHandlerTouchesBody` is
//      forced `true` unconditionally — the reuse path never engages for
//      this handler style at all.
//   2. Even when forced onto the reuse path directly (bare arrow-function
//      handler, where the heuristic happens to evaluate correctly), the
//      measured improvement was ~0.8%, not the >=5% hypothesized — socket
//      round-trip cost dominates per-message time in this benchmark, not
//      the `Object.create` allocation.
//
// BEFORE (881e3458, Object.create(connection) every frame):
//   runs (msg/s): 39387, 39384, 39136, 39037, 38987
//   best: 39387 msg/s
//
// AFTER (connection reused when handler never touches body — same
// method-shorthand handler as below, so the flag above stayed forced
// `true` and this lane was never exercised; numbers are noise vs BEFORE):
//   runs (msg/s): 38976, 38297, 38037, 37973, 37581
//   best: 38976 msg/s (-1.0% vs BEFORE-best; within run-to-run noise)
//
// Diagnostic-only re-run swapping to a bare arrow-function handler (not
// shipped in this file, to keep the bench matching the plan's spec) to
// force the flag to evaluate `false` and actually exercise the reuse path:
//   BEFORE arrow-fn best: 39309 msg/s
//   AFTER  arrow-fn best: 39610 msg/s (+0.8% — still far under the 2% gate)

import { Elysia } from '../src'

const MESSAGES = 20_000
const RUNS = 5
const MESSAGE = 'x'.repeat(16)

async function runOnce(): Promise<number> {
	const app = new Elysia()
		.ws('/echo', {
			// Must never reference `body` — keeps this on the no-touch
			// sync-dispatch lane under test.
			message(ws, msg) {
				ws.send(msg)
			}
		})
		.listen(0)

	const ws = new WebSocket(`ws://${app.server!.hostname}:${app.server!.port}/echo`)

	await new Promise<void>((resolve, reject) => {
		ws.onopen = () => resolve()
		ws.onerror = reject
	})

	const start = performance.now()

	await new Promise<void>((resolve, reject) => {
		let received = 0

		ws.onmessage = () => {
			received++
			if (received === MESSAGES) return resolve()
			ws.send(MESSAGE)
		}
		ws.onerror = reject

		ws.send(MESSAGE)
	})

	const elapsedMs = performance.now() - start

	ws.close()
	app.stop()

	return MESSAGES / (elapsedMs / 1000)
}

// Warmup (excluded from results).
await runOnce()

const results: number[] = []
for (let i = 0; i < RUNS; i++) results.push(await runOnce())

results.sort((a, b) => b - a)

console.log(`runs (msg/s): ${results.map((r) => Math.round(r)).join(', ')}`)
console.log(`best: ${Math.round(results[0])} msg/s`)
