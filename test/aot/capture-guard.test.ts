/** Missing capture support must fail instead of producing a partial manifest. */
import {
	abortCapture,
	beginValidatorCapture,
	endValidatorCapture
} from '../../src/compile/aot-capture'
import { describe, it, expect, afterEach } from 'bun:test'
import { captureImpl, setCaptureImpl } from '../../src/compile/aot'
import { Elysia } from '../../src'

describe('validator capture availability', () => {
	afterEach(() => {
		try {
			endValidatorCapture()
		} catch {}
	})

	it('rejects capture when the implementation is unavailable', () => {
		const saved = captureImpl!
		try {
			setCaptureImpl(undefined)
			expect(() => beginValidatorCapture()).toThrowError()
		} finally {
			setCaptureImpl(saved)
		}
	})

	it('starts and ends capture when the implementation is installed', () => {
		expect(() => {
			beginValidatorCapture()
			endValidatorCapture()
		}).not.toThrow()
	})

	// The AOT plugin sets ELYSIA_AOT_BUILD before importing the user's entry
	// module. A top-level `app.fetch`/`.compile()` there leaves an implicit
	// external capture session behind; the plugin's own capture must adopt it
	// instead of aborting the whole build.
	it('adopts the implicit ELYSIA_AOT_BUILD session left by a top-level fetch', () => {
		const previous = process.env.ELYSIA_AOT_BUILD
		process.env.ELYSIA_AOT_BUILD = '1'

		try {
			const app = new Elysia().get('/', () => 'ok')
			void app.fetch

			expect(() => beginValidatorCapture()).not.toThrow()

			// a genuinely overlapping explicit capture must still fail loud
			expect(() => beginValidatorCapture()).toThrow(
				'A capture session is already active'
			)
		} finally {
			abortCapture()

			if (previous === undefined) delete process.env.ELYSIA_AOT_BUILD
			else process.env.ELYSIA_AOT_BUILD = previous
		}
	})
})
