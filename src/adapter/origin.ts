/**
 * Provenance channel for deferred abort-signal arming.
 *
 * Bun materializes `Request.signal` lazily (~214ns on the first read), so
 * Elysia only pays for it once the pipeline can actually observe an abort,
 * that is, after it suspends. Deferring that read is only sound for the exact
 * `Request` instance `Bun.serve` handed to `fetch`: any other request
 * (`app.handle`, a non-Bun adapter, or a `.wrap()` HOC that substitutes the
 * request) may carry a user-controlled signal that is already aborted at entry
 * and therefore must be observed synchronously.
 *
 * The Bun adapter publishes the untouched original here for the *synchronous*
 * prologue of `app.fetch` and, on the lane where `fetch` has no request hook
 * to run, for the compiled route's own entry probe, which is still inside that
 * same synchronous frame, then clears it in `finally`, so the window closes
 * before the first suspension and cannot leak across concurrent requests.
 * A `.wrap()` HOC that replaces the request or defers calling `next()` past a
 * microtask simply misses the window, fetch handler falls back to eager check
 *
 * ## "A single shared slot that every request writes to, so a race condition?"
 *
 * It looks like one, but it can't be. Explained like you're five:
 *
 * JavaScript only ever does ONE thing at a time. When a request comes in, the
 * adapter writes its name on the whiteboard (`origin.request = request`),
 * walks it down the hall (`fetch(request)` the synchronous part, where the
 * one and only identity check happens, in `fetch`'s prologue, or at the
 * compiled route's entry when `fetch` had no hook to run first), and erases
 * the whiteboard `finally`
 * all in one uninterruptible turn. The next request's turn CANNOT start
 * until this turn is completely finished, because that is how the event loop
 * works: run-to-completion, no preemption. So request B can never see request
 * A's name on the board, by the time B's turn starts, the board was already
 * erased at the end of A's turn.
 *
 * "But the handler is async!" — the `await`s inside it run LATER, in separate
 * turns. That is fine, because the check already happened: the verdict was
 * copied onto that request's own context (`'~sig'`) during the synchronous
 * part, and the code that runs after an `await` only ever reads the context,
 * never this slot.
 *
 * And if any assumption here ever breaks, a runtime that re-enters, a wrap
 * that delays, a future edit that sneaks an `await` in before the check the
 * comparison simply MISSES and the request falls back to eager arming, which
 * is the exact pre-optimization behavior. Every failure mode makes a request
 * slightly slower, never incorrect
 *
 * Adversarial proof, not just argument: `test/core/abort-race.test.ts` storms
 * concurrent servers, in-process `handle()` calls, request-substituting and
 * `next()`-delaying wraps at this slot and asserts zero misclassification.
 *
 * Never infer the Bun runtime from `fetch`'s second argument: Cloudflare
 * Workers pass `env` there.
 *
 * It's insanely stupid, but it works. As Bun is single-threaded and synchronous
 * so the `finally` block will always run before the next request comes in.
 */
export const origin: { request: Request | undefined } = {
	request: undefined
}
