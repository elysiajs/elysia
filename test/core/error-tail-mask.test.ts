import { describe, it, expect } from 'bun:test'

// Each process starts with the requested NODE_ENV before compiling the fixture.
const FIXTURE = new URL('./error-tail-mask.fixture.ts', import.meta.url)
	.pathname

interface Scenario {
	status: number
	body: string
}

const run = async (nodeEnv: string): Promise<Record<string, Scenario>> => {
	const env: Record<string, string> = {}
	for (const k in process.env)
		if (process.env[k] !== undefined) env[k] = process.env[k] as string
	env.NODE_ENV = nodeEnv

	const proc = Bun.spawn(['bun', 'run', FIXTURE], {
		env,
		stdout: 'pipe',
		stderr: 'pipe'
	})

	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text()
	])
	await proc.exited

	if (proc.exitCode !== 0)
		throw new Error(
			`fixture exited ${proc.exitCode}:\n${stderr}\n${stdout}`
		)

	return JSON.parse(stdout.trim()) as Record<string, Scenario>
}

describe('compiled error tail', () => {
	it('masks only implicit 5xx messages in production', async () => {
		const r = await run('production')

		expect(r.fiveHundred.status).toBe(500)
		expect(r.fiveHundred.body).toBe('Internal Server Error')
		expect(r.fiveHundred.body).not.toContain('hunter2')

		expect(r.fiveOhThree.status).toBe(503)
		expect(r.fiveOhThree.body).toBe('Internal Server Error')

		expect(r.explicitResponse.status).toBe(500)
		expect(r.explicitResponse.body).toBe('explicit body')

		expect(r.fourHundred.status).toBe(400)
		expect(r.fourHundred.body).toContain('hunter2')
	})

	it('keeps error messages in development', async () => {
		const r = await run('development')

		expect(r.fiveHundred.status).toBe(500)
		expect(r.fiveHundred.body).toContain('hunter2')
	})

	it('matches the interpreted path when toResponse throws synchronously', async () => {
		const prod = await run('production')

		expect(prod.syncThrowCompiled.body).not.toContain('INNER-THROW-LEAK')
		expect(prod.syncThrowCompiled.body).toBe('Internal Server Error')
		expect(prod.syncThrowCompiled.status).toBe(503)
		expect(prod.syncThrowCompiled.status).toBe(
			prod.syncThrowInterpreted.status
		)
		expect(prod.syncThrowCompiled.body).toBe(prod.syncThrowInterpreted.body)

		const dev = await run('development')

		expect(dev.syncThrowCompiled.body).not.toContain('INNER-THROW-LEAK')
		expect(dev.syncThrowCompiled.body).toContain('original 503 message')
		expect(dev.syncThrowCompiled.status).toBe(503)
		expect(dev.syncThrowCompiled.status).toBe(
			dev.syncThrowInterpreted.status
		)
		expect(dev.syncThrowCompiled.body).toBe(dev.syncThrowInterpreted.body)
	})
})
