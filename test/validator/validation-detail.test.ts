import { describe, it, expect } from 'bun:test'

// `isProduction` (src/error.ts) is evaluated once at module load, so the gate
// can't be toggled in-process. Each scenario is therefore run in a fresh `bun`
// process (see validation-detail.fixture.ts) with NODE_ENV pre-set.
const FIXTURE = new URL('./validation-detail.fixture.ts', import.meta.url)
	.pathname

interface Scenario {
	status: number
	body: any
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

	const raw = JSON.parse(stdout.trim()) as Record<
		string,
		{ status: number; body: string }
	>

	const parsed: Record<string, Scenario> = {}
	for (const k in raw) {
		let body: any = raw[k].body
		try {
			body = JSON.parse(raw[k].body)
		} catch {}
		parsed[k] = { status: raw[k].status, body }
	}

	return parsed
}

describe('validation detail — production gating', () => {
	it('production omits schema detail, honors allowUnsafe + custom message', async () => {
		const r = await run('production')

		// default → minimal { type, on, found }, no schema-revealing fields
		expect(r.default.status).toBe(422)
		expect(r.default.body.type).toBe('validation')
		expect(r.default.body.on).toBe('body')
		expect(r.default.body.found).toEqual({ x: 'not a number' })
		expect(r.default.body.property).toBeUndefined()
		expect(r.default.body.expected).toBeUndefined()
		expect(r.default.body.errors).toBeUndefined()

		// allowUnsafeValidationDetails → full detail restored in production
		expect(r.allowUnsafe.body.property).toBeDefined()
		expect(r.allowUnsafe.body.errors).toBeArray()

		// validationDetail custom message is surfaced without leaking schema
		expect(r.validationDetailMessage.body.message).toBe('x must be a number')
		expect(r.validationDetailMessage.body.errors).toBeUndefined()
		expect(r.validationDetailMessage.body.value).toBeUndefined()

		// error.detail() → minimal in production
		expect(r.detail.body.message).toBe('x must be a number')
		expect(r.detail.body.found).toEqual({ x: 'not a number' })
		expect(r.detail.body.errors).toBeUndefined()

		// error.detail() → full when allowUnsafe even in production
		expect(r.detailAllowUnsafe.body.errors).toBeArray()

		// nested custom error resolves via findCustomError path navigation
		expect(r.nestedCustomError.status).toBe(422)
		expect(r.nestedCustomError.body.message).toBe('age must be a number')

		// the custom-error path used findCustomError, NOT TypeBox Errors:
		// the throwing thunk was never consulted (status 422, message present)
		expect(r.findCustomErrorBypass.status).toBe(422)
		expect(r.findCustomErrorBypass.body.message).toBe('from findCustomError')
		expect(r.findCustomErrorBypass.body.found).toEqual({ x: 'bad' })
	})

	it('non-production keeps full detail (gate off)', async () => {
		const r = await run('development')

		expect(r.default.body.property).toBeDefined()
		expect(r.default.body.errors).toBeArray()
	})
})
