import { describe, it, expect } from 'bun:test'

// the COMPILED error tail (jit.ts) must mirror the interpreted path's
// production 5xx-message mask (src/handler/error.ts fallbackErrorResponse). The
// mask depends on runtime NODE_ENV, which the tail links as `isprod` — so each
// scenario runs in a fresh `bun` process with NODE_ENV pre-set.
const FIXTURE = new URL('./error-tail-mask.fixture.ts', import.meta.url).pathname

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
		throw new Error(`fixture exited ${proc.exitCode}:\n${stderr}\n${stdout}`)

	return JSON.parse(stdout.trim()) as Record<string, Scenario>
}

describe('compiled error tail — production 5xx message mask', () => {
	it('masks 5xx error.message in production, mirroring the interpreted path', async () => {
		const r = await run('production')

		// the thrown 5xx message must NOT reach the client in production
		expect(r.fiveHundred.status).toBe(500)
		expect(r.fiveHundred.body).toBe('Internal Server Error')
		expect(r.fiveHundred.body).not.toContain('hunter2')

		expect(r.fiveOhThree.status).toBe(503)
		expect(r.fiveOhThree.body).toBe('Internal Server Error')

		// explicit e.response wins even at 5xx — the user opted to expose it
		expect(r.explicitResponse.status).toBe(500)
		expect(r.explicitResponse.body).toBe('explicit body')

		// 4xx is a client error: message is intentionally surfaced (only >= 500
		// is masked), matching fallbackErrorResponse
		expect(r.fourHundred.status).toBe(400)
		expect(r.fourHundred.body).toContain('hunter2')
	})

	it('keeps the message in development (dev parity with interpreted path)', async () => {
		const r = await run('development')

		// dev shows the message on the compiled path too — the two paths must not
		// diverge (attaching a logging .error() hook must not change hygiene)
		expect(r.fiveHundred.status).toBe(500)
		expect(r.fiveHundred.body).toContain('hunter2')
	})

	it('a sync-throwing toResponse() falls back to the ORIGINAL error, not the inner throw', async () => {
		// WHY: the interpreted path wraps toResponse() in try/catch and, on a sync
		// throw, responds from the ORIGINAL error (5xx-mask). The compiled tail had
		// no try/catch, so the inner throw escaped and re-entered fetch-level
		// handling with the WRONG error — losing .status and, in dev, leaking the
		// inner message. The two paths MUST agree.
		const prod = await run('production')

		// production: 5xx masked, the inner throw text must never reach the client
		expect(prod.syncThrowCompiled.body).not.toContain('INNER-THROW-LEAK')
		expect(prod.syncThrowCompiled.body).toBe('Internal Server Error')
		// original 503 status is preserved (not collapsed by the escaping inner 500)
		expect(prod.syncThrowCompiled.status).toBe(503)
		// exact parity with the interpreted reference
		expect(prod.syncThrowCompiled.status).toBe(
			prod.syncThrowInterpreted.status
		)
		expect(prod.syncThrowCompiled.body).toBe(prod.syncThrowInterpreted.body)

		const dev = await run('development')

		// development: the ORIGINAL error's message is surfaced (not the inner one)
		expect(dev.syncThrowCompiled.body).not.toContain('INNER-THROW-LEAK')
		expect(dev.syncThrowCompiled.body).toContain('original 503 message')
		expect(dev.syncThrowCompiled.status).toBe(503)
		// exact parity with the interpreted reference
		expect(dev.syncThrowCompiled.status).toBe(dev.syncThrowInterpreted.status)
		expect(dev.syncThrowCompiled.body).toBe(dev.syncThrowInterpreted.body)
	})
})
