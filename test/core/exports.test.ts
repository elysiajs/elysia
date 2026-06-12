import { describe, it, expect } from 'bun:test'

// A1 (API parity): symbols that must remain importable from the package entry.
// Value re-exports are asserted at runtime; type re-exports are asserted by this
// file type-checking (build/dts generation fails if a type export is dropped).
import { Cookie, serializeCookie, StatusMap, env } from '../../src'

import type {
	SSEPayload,
	TraceEvent,
	TraceStream,
	TraceProcess,
	TraceListener,
	TraceHandler
} from '../../src'

describe('package export surface (A1)', () => {
	it('re-exports the v1-parity runtime symbols', () => {
		expect(typeof Cookie).toBe('function')
		expect(typeof serializeCookie).toBe('function')
		expect(typeof env).toBe('object')
		expect(StatusMap.OK).toBe(200)
	})

	it('keeps the trace + SSE types importable', () => {
		// type-only — referenced so the import is not elided; the assertion is
		// that this file type-checks (a dropped type export breaks the build).
		const _types = [
			null as unknown as SSEPayload,
			null as unknown as TraceEvent,
			null as unknown as TraceStream,
			null as unknown as TraceProcess,
			null as unknown as TraceListener,
			null as unknown as TraceHandler
		]
		expect(_types.length).toBe(6)
	})
})
