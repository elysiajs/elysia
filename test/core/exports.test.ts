import { describe, it, expect } from 'bun:test'

import { StatusMap, env } from '../../src'

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
