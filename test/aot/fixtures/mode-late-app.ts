import { Elysia } from 'elysia'

// DEFECT 2 (late route): a route registered AFTER the app has been sealed must
// NOT retroactively appear in the AOT capture snapshot. The app is exported
// empty; a route is added on the next macrotask.
//
// Under Q4 (B6 semantic freeze) a sealed app is immutable, so the late `.get()`
// is only legal while the app is still authorable. This fixture is imported in
// two distinct runtimes:
//
//   - CAPTURE runtime (`generateCompiledArtifacts` / the AOT plugin): awaits
//     `app.modules` then calls `app.compile()`, which SEALS the app. By the time
//     this timer fires the app is sealed, so the guard below skips the mutation —
//     the gate captures zero routes/handlers and must not seal on vacuous truth.
//
//   - BUNDLE runtime (the emitted `.mjs`, imported by the e2e smoke test): the
//     bundle never compiles the app at import, so it is still authorable when the
//     timer fires. The route registers, and the FIRST request seals it — reaching
//     the stripped handler-JIT stub (500), never the severed bridge.
//
// The `~generation` guard keeps a single fixture correct in both runtimes without
// ever tripping the Q4 seal guard (which would throw an unhandled error inside
// the untracked timer).
export const app = new Elysia()

setTimeout(() => {
	if ((app as { ['~generation']?: unknown })['~generation'] === undefined)
		app.get('/late', () => 'late')
}, 0)
