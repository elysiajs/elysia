import { Elysia } from 'elysia'

// DEFECT 2 (late route): routes registered AFTER the capture snapshot. The app
// is exported empty; a route is added on the next microtask. The gate captures
// zero routes/handlers/validators, so `[].every()` is vacuously true. A seal
// decision must not rest on vacuous truth.
export const app = new Elysia()

// Register a route after the module's synchronous evaluation. The plugin's
// `captureArtifacts` awaits `app.modules` but not this untracked timer, so the
// route is absent at capture time.
setTimeout(() => {
	app.get('/late', () => 'late')
}, 0)
