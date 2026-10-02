import { emptyResponse, getNotFound } from '../../src/handler/utils'
import { describe, expect, it } from 'bun:test'

// ELYSIA_PREALLOCATE_RESPONSE is an opt-OUT: unless it is set to 'false'
// (or the runtime is CF/Fastly), responses are preallocated and cloned.
// Guards the `=== 'false'` polarity — `!==` silently disables preallocation
// on every runtime and only shows up as an unattributed throughput regression
describe('response preallocation', () => {
	it('preallocates by default on runtimes that allow it', () => {
		expect(emptyResponse).toBeInstanceOf(Response)
	})

	it('serves a cloned not-found, not a shared instance', async () => {
		const a = getNotFound()
		const b = getNotFound()

		expect(a).not.toBe(b)
		expect(a.status).toBe(404)
		expect(await a.json()).toEqual(await b.json())
	})
})
