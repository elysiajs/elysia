// Response-schema failures are server errors in every error-hook path.
// Production must mask them like any other internal error.

import { describe, it, expect } from 'bun:test'

const PROBE = new URL('./_response-500-probe.ts', import.meta.url).pathname

interface Served {
	status: number
	body: string
}

type Report = Record<
	| 'noHook'
	| 'hookReturnsValue'
	| 'hookReadsSetStatus'
	| 'hookReturnsUndefined'
	| 'genericThrow'
	| 'requestViolation',
	Served
>

const runProbe = async (nodeEnv?: string): Promise<Report> => {
	const proc = Bun.spawn(['bun', 'run', PROBE], {
		env: { ...process.env, NODE_ENV: nodeEnv },
		stdout: 'pipe',
		stderr: 'pipe'
	})

	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited
	])

	if (code !== 0) throw new Error(`probe exited ${code}\nstderr:\n${stderr}`)

	return JSON.parse(stdout.trim())
}

describe('response-schema violation status', () => {
	it('serves 500 through every error-hook shape in development', async () => {
		const report = await runProbe()

		expect(report.noHook.status).toBe(500)
		expect(report.hookReturnsUndefined.status).toBe(500)
		expect(report.hookReturnsValue.status).toBe(500)
		expect(JSON.parse(report.hookReturnsValue.body)).toEqual({
			oops: 'must be number'
		})

		expect(report.hookReadsSetStatus.status).toBe(500)
		expect(JSON.parse(report.hookReadsSetStatus.body)).toEqual({
			sawStatus: 500
		})

		// Request validation is still the client's fault.
		expect(report.requestViolation.status).toBe(422)
	})

	it('serves 500 through every error-hook shape in production', async () => {
		const report = await runProbe('production')

		expect(report.noHook.status).toBe(500)
		expect(report.hookReturnsValue.status).toBe(500)
		expect(report.hookReadsSetStatus.status).toBe(500)
		expect(JSON.parse(report.hookReadsSetStatus.body)).toEqual({
			sawStatus: 500
		})
		expect(report.requestViolation.status).toBe(422)
	})

	it('masks the violation as the same problem the generic 500 funnel serves', async () => {
		const report = await runProbe('production')

		const masked = JSON.parse(report.noHook.body)

		expect(masked.code).toBe('internal-server-error')
		expect(masked.type).toBe('https://ex.test/errors/internal-server-error')
		expect(masked).toEqual(JSON.parse(report.genericThrow.body))
	})

	it('keeps the development body on the same identity triple', async () => {
		const report = await runProbe()

		const dev = JSON.parse(report.noHook.body)
		const generic = JSON.parse(report.genericThrow.body)

		expect(dev.code).toBe('internal-server-error')
		expect(dev.type).toBe(generic.type)
		expect(dev.title).toBe(generic.title)
		expect(dev.status).toBe(500)
		expect(dev.on).toBe('response')
	})
})
