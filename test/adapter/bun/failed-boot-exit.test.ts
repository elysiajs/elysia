// Failed startup must log the cause and set a non-zero exit code.
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'

import { Elysia } from '../../../src'

const FIXTURE = new URL('./failed-boot-exit.fixture.ts', import.meta.url)
	.pathname

describe('Bun failed boot exit code', () => {
	// Reset the shared test process after each failure case.
	beforeEach(() => {
		process.exitCode = 0
	})

	afterEach(() => {
		process.exitCode = 0
	})

	it('marks the process failed once the rollback is done', async () => {
		const reported = spyOn(console, 'error').mockImplementation(() => {})

		try {
			const app = new Elysia()
				.use(Promise.reject(new Error('plugin-fail')))
				.get('/', () => 'ok')

			app.listen(0)

			await expect(app.modules).rejects.toThrow('plugin-fail')
			await Bun.sleep(10)

			expect(app.server).toBeUndefined()
			expect(process.exitCode).toBe(1)

			expect(
				reported.mock.calls.filter(
					(call) =>
						typeof call[0] === 'string' &&
						call[0].startsWith('[Elysia] listen() failed:')
				)
			).toHaveLength(1)
		} finally {
			reported.mockRestore()
		}
	})

	it('does not touch the exit code on a healthy boot', async () => {
		const app = new Elysia().get('/', () => 'ok').listen(0)

		const port = app.server!.port
		await expect(
			fetch(`http://localhost:${port}/`).then((r) => r.text())
		).resolves.toBe('ok')

		expect(process.exitCode).toBe(0)

		await app.server!.stop(true)
	})

	it('exits non-zero when the process ends naturally', async () => {
		const proc = Bun.spawn(['bun', 'run', FIXTURE], {
			stdout: 'pipe',
			stderr: 'pipe'
		})

		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text()
		])
		await proc.exited

		expect(proc.exitCode).toBe(1)
		expect(stderr).toContain('[Elysia] listen() failed:')
		expect(stderr).toContain('db connect failed')
		expect(stderr.split('[Elysia] listen() failed:')).toHaveLength(2)

		expect(stdout).not.toContain('CALLBACK')
		expect(stdout).toContain('SOCKET_RELEASED=true')
		expect(stdout).toContain('SERVER=undefined')
	})
})
