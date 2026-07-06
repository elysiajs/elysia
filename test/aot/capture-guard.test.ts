/**
 * Pin: beginValidatorCapture + isValidatorCapturing must throw when captureImpl
 * is not installed, rather than silently producing a corrupt/partial manifest.
 *
 * WHY: if ELYSIA_AOT_BUILD is set (or capture is started) but the AOT capture
 * module was never loaded, the capture impl slot is undefined. Previously both
 * entry points would return true / proceed, causing silent partial-manifest bugs.
 */
import '../../src/compile/aot-capture' // installs captureImpl
import { describe, it, expect, afterEach } from 'bun:test'
import {
	beginValidatorCapture,
	endValidatorCapture,
	captureImpl,
	setCaptureImpl
} from '../../src/compile/aot'

describe('capture impl guard', () => {
	// Restore the real impl after each test that temporarily uninstalls it
	afterEach(() => {
		// If captureImpl was nulled out, restore from the real module
		if (captureImpl === undefined) {
			const real = require('../../src/compile/aot-capture')
			setCaptureImpl(real.captureImplementation)
		}
		// Clean up any in-progress capture
		try { endValidatorCapture() } catch {}
	})

	it('throws when beginValidatorCapture is called without captureImpl installed', () => {
		// Temporarily uninstall the impl
		const saved = captureImpl!
		setCaptureImpl(undefined)

		expect(() => beginValidatorCapture()).toThrow(
			'AOT capture module is not installed'
		)

		// Restore immediately so afterEach is not needed for the throw case
		setCaptureImpl(saved)
	})

	it('works normally when captureImpl is installed', () => {
		expect(() => {
			beginValidatorCapture()
			endValidatorCapture()
		}).not.toThrow()
	})
})
