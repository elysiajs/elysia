/** Missing capture support must fail instead of producing a partial manifest. */
import '../../src/compile/aot-capture'
import { describe, it, expect, afterEach } from 'bun:test'
import {
	beginValidatorCapture,
	endValidatorCapture,
	captureImpl,
	setCaptureImpl
} from '../../src/compile/aot'

describe('validator capture availability', () => {
	afterEach(() => {
		if (captureImpl === undefined) {
			const real = require('../../src/compile/aot-capture')
			setCaptureImpl(real.captureImplementation)
		}
		try {
			endValidatorCapture()
		} catch {}
	})

	it('rejects capture when the implementation is unavailable', () => {
		const saved = captureImpl!
		setCaptureImpl(undefined)

		expect(() => beginValidatorCapture()).toThrowError()

		setCaptureImpl(saved)
	})

	it('starts and ends capture when the implementation is installed', () => {
		expect(() => {
			beginValidatorCapture()
			endValidatorCapture()
		}).not.toThrow()
	})
})
