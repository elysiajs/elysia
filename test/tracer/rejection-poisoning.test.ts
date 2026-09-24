// Trace is a side channel, so its rejected callbacks must not reject the process.

import { describe, it, expect } from 'bun:test'

const FIXTURE = new URL('./_rejection.fixture.ts', import.meta.url).pathname

const runFixture = async (shape: string) => {
	const proc = Bun.spawn(['bun', 'run', FIXTURE], {
		env: { ...process.env, TRACE_SHAPE: shape },
		stdout: 'pipe',
		stderr: 'pipe'
	})

	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text()
	])
	await proc.exited

	const lines = stdout.trim().split('\n').filter(Boolean)
	const report = lines.pop()

	return {
		exitCode: proc.exitCode,
		stderr,
		lines,
		...(JSON.parse(report!) as {
			status: number
			body: string
			errors: number
		})
	}
}

describe('a rejecting trace callback does not poison the process', () => {
	for (const shape of ['listener', 'onHandle', 'onAfterResponse'])
		it(`survives a rejecting ${shape} callback`, async () => {
			const result = await runFixture(shape)

			expect(result.status).toBe(200)
			expect(result.body).toBe('ok')

			expect(result.errors).toBe(1)
			expect(
				result.lines.filter((line) => line.startsWith('TRACE-ERROR'))
			).toHaveLength(1)
			expect(result.lines[0]).toContain('trace boom')

			expect(
				result.lines.filter(
					(line) =>
						line.startsWith('UNHANDLED') ||
						line.startsWith('UNCAUGHT')
				)
			).toEqual([])
			expect(result.exitCode).toBe(0)
		})
})
