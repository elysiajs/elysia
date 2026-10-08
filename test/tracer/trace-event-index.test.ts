import { describe, expect, it } from 'bun:test'
import { traceEventIndex, traceEvents } from '../../src/constants'

// `traceEventIndex` is a hand-written literal so import does not run
// `Object.fromEntries`; the compiled trace slots read it, so it must stay the
// inverse of `traceEvents` when an event is added or reordered
describe('Trace Event Index', () => {
	it('maps every trace event to its position', () => {
		traceEvents.forEach((event, index) => {
			expect(traceEventIndex[event]).toBe(index)
		})
	})

	it('lists the same events in the same order', () => {
		expect(Object.keys(traceEventIndex)).toEqual([...traceEvents])
	})
})
