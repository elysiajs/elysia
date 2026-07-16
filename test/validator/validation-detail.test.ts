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
		throw new Error(
			`fixture exited ${proc.exitCode}:\n${stderr}\n${stdout}`
		)

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

		// default → minimal { type, on, property, found }, no schema-revealing
		// fields.: `property` (instance path only) IS now included so the
		// client knows which field failed; schema-derived `expected`/`errors` are
		// still withheld.
		expect(r.default.status).toBe(422)
		expect(r.default.body.type).toBe('validation')
		expect(r.default.body.on).toBe('body')
		// `found` redacted in production (request input may be PII)
		expect(r.default.body.found).toBeUndefined()
		expect(r.default.body.property).toBe('/x')
		expect(r.default.body.expected).toBeUndefined()
		expect(r.default.body.errors).toBeUndefined()

		// allowUnsafeValidationDetails → full detail restored in production
		expect(r.allowUnsafe.body.property).toBeDefined()
		expect(r.allowUnsafe.body.errors).toBeArray()

		// validationDetail custom message is surfaced without leaking schema
		expect(r.validationDetailMessage.body.message).toBe(
			'x must be a number'
		)
		expect(r.validationDetailMessage.body.errors).toBeUndefined()
		expect(r.validationDetailMessage.body.value).toBeUndefined()

		// error.detail → minimal in production (: no `found` echo)
		expect(r.detail.body.message).toBe('x must be a number')
		expect(r.detail.body.found).toBeUndefined()
		expect(r.detail.body.errors).toBeUndefined()

		// error.detail → full when allowUnsafe even in production
		expect(r.detailAllowUnsafe.body.errors).toBeArray()

		// nested custom error resolves via findCustomError path navigation
		expect(r.nestedCustomError.status).toBe(422)
		expect(r.nestedCustomError.body.message).toBe('age must be a number')

		// the custom-error path used findCustomError, NOT TypeBox Errors:
		// the throwing thunk was never consulted (status 422, message present)
		expect(r.findCustomErrorBypass.status).toBe(422)
		expect(r.findCustomErrorBypass.body.message).toBe(
			'from findCustomError'
		)
		expect(r.findCustomErrorBypass.body.found).toBeUndefined()
	})

	it('returns a generic 500 without echoing an invalid server response', async () => {
		const r = await run('production')

		// A response-schema failure is a SERVER bug, not a client (422) error, and
		// `this.value` is the server's own response. In production it must become a
		// generic 500 problem+json with NO found/errors/property and no secret.
		expect(r.responseLeak.status).toBe(500)
		expect(r.responseLeak.body.type).toBe('internal-server-error')
		expect(r.responseLeak.body.status).toBe(500)
		expect(r.responseLeak.body.found).toBeUndefined()
		expect(r.responseLeak.body.errors).toBeUndefined()
		// the offending server object (incl. secrets) must not appear anywhere
		expect(JSON.stringify(r.responseLeak.body)).not.toContain('SECRET')
		expect(JSON.stringify(r.responseLeak.body)).not.toContain(
			'passwordHash'
		)

		// a custom-error callback on the response schema must not receive the
		// server value (so it can't echo it) and must not yield a 422
		expect(r.responseCustomError.status).toBe(500)
		expect(JSON.stringify(r.responseCustomError.body)).not.toContain(
			'SECRET_TOKEN'
		)

		// opt-out restores full response detail under production
		expect(r.responseAllowUnsafe.status).toBe(422)
		expect(r.responseAllowUnsafe.body.on).toBe('response')
	})

	it('request-side production 422 names the failing field without echoing input', async () => {
		const r = await run('production')

		// An API consumer needs to know WHICH field failed to fix their request;
		// the instance path is safe (no schema info, no messages).
		expect(r.requestProperty.status).toBe(422)
		expect(r.requestProperty.body.property).toBe('/x')
		// `found` is NO LONGER echoed in production — even the client's
		// own input can carry passwords/tokens/PII that leak into error trackers,
		// proxy logs, and HAR exports.
		expect(r.requestProperty.body.found).toBeUndefined()
		// and nothing schema-revealing
		expect(r.requestProperty.body.errors).toBeUndefined()
		expect(r.requestProperty.body.expected).toBeUndefined()
	})

	it('production `property` only reflects instance-path-shaped data', async () => {
		const r = await run('production')

		// a hand-crafted issue whose only path is a free-text string (no real
		// validator emits this) must NOT surface as `property` — it collapses to
		// 'root' so schema/message text can't leak through the trust boundary
		expect(r.propertyFreeTextString.status).toBe(422)
		expect(r.propertyFreeTextString.body.property).toBe('root')
		expect(JSON.stringify(r.propertyFreeTextString.body)).not.toContain(
			'secret field'
		)
		// response-type still fully masked (no property surfaced at all)
		expect(r.propertyFreeTextString.body.type).toBe('validation')

		// a real `instancePath` JSON pointer still passes through unchanged
		expect(r.propertyInstancePath.status).toBe(422)
		expect(r.propertyInstancePath.body.property).toBe('/x')
	})

	it('Standard Schema object path segments render as `/user/name`, not `[object Object]`', async () => {
		const r = await run('production')

		// A Standard Schema issue path is an array of `{ key }` objects; production
		// `payload.property` must extract `.key` per segment (mirroring `found`),
		// otherwise it emits `/[object Object]/[object Object]` and hides the field.
		expect(r.propertyStandardObjectSegments.status).toBe(422)
		expect(r.propertyStandardObjectSegments.body.property).toBe(
			'/user/name'
		)
		expect(r.propertyStandardObjectSegments.body.property).not.toContain(
			'[object Object]'
		)
	})

	it('`.all` dotted path from Standard Schema object segments renders as `user.name`', async () => {
		// env-independent — same root cause, same shared segment stringifier
		for (const env of ['production', 'development']) {
			const r = await run(env)
			expect(Array.isArray(r.allStandardObjectSegments.body)).toBe(true)
			expect(r.allStandardObjectSegments.body[0].path).toBe('user.name')
			expect(r.allStandardObjectSegments.body[0].path).not.toContain(
				'[object Object]'
			)
		}
	})

	it('non-production keeps full detail (gate off)', async () => {
		const r = await run('development')

		expect(r.default.body.property).toBeDefined()
		expect(r.default.body.errors).toBeArray()

		// Production masking does not apply in development, which keeps full detail.
		// (the developer inspects their own server's response — no leak surface).
		expect(r.responseLeak.status).toBe(422)
		expect(r.responseLeak.body.on).toBe('response')
		expect(r.responseLeak.body.errors).toBeArray()
	})

	it('bounds the serialized found echo by UTF-8 bytes', async () => {
		const r = await run('development')
		const found = JSON.stringify(r.cjkEcho.body.found ?? '')

		expect(r.cjkEcho.status).toBe(422)
		expect(new TextEncoder().encode(found).length).toBeLessThanOrEqual(8192)
	})

	it('formats validation failures without replaying user refinements', async () => {
		const r = await run('development')

		expect(r.refineNoReplay.status).toBe(422)
		expect(r.refineNoReplay.body.responseStatus).toBe(422)
		expect(r.refineNoReplay.body.responseBody.errors).toBeArray()
		expect(r.refineNoReplay.body.calls).toBe(1)

		expect(r.patternError.status).toBe(422)
		expect(r.patternError.body.errors).toBeArray()
		expect(r.patternError.body.detail).toContain('pattern')
	})
})
