import { describe, it, expect } from 'bun:test'

// Run each environment in a child process so its scenarios share no module state.
const FIXTURE = new URL('./validation-detail.fixture.ts', import.meta.url)
	.pathname

interface Scenario {
	status: number
	body: any
}

const runFixture = async (
	nodeEnv: string
): Promise<Record<string, Scenario>> => {
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

const results = new Map<string, Promise<Record<string, Scenario>>>()

const run = (nodeEnv: string) => {
	let result = results.get(nodeEnv)
	if (!result) {
		result = runFixture(nodeEnv)
		results.set(nodeEnv, result)
	}
	return result
}

describe('validation detail', () => {
	describe('production masking', () => {
		it('keeps request failures actionable without exposing input or schema details', async () => {
			const r = await run('production')

			expect(r.maskedRequest.status).toBe(422)
			expect(r.maskedRequest.body.type).toBe('validation')
			expect(r.maskedRequest.body.on).toBe('body')
			expect(r.maskedRequest.body.property).toBe('/x')
			expect(r.maskedRequest.body.found).toBeUndefined()
			expect(r.maskedRequest.body.expected).toBeUndefined()
			expect(r.maskedRequest.body.errors).toBeUndefined()
		})

		it('restores request details when allowUnsafeValidationDetails is enabled', async () => {
			const r = await run('production')

			expect(r.unsafeRequest.body.property).toBeDefined()
			expect(r.unsafeRequest.body.errors).toBeArray()
			expect(r.unsafeErrorDetail.body.errors).toBeArray()
		})

		it('returns custom messages without exposing schema details', async () => {
			const r = await run('production')

			expect(r.customRequestMessage.body.message).toBe(
				'x must be a number'
			)
			expect(r.customRequestMessage.body.errors).toBeUndefined()
			expect(r.customRequestMessage.body.value).toBeUndefined()
			expect(r.maskedErrorDetail.body.message).toBe('x must be a number')
			expect(r.maskedErrorDetail.body.found).toBeUndefined()
			expect(r.maskedErrorDetail.body.errors).toBeUndefined()
		})

		it('finds a nested custom error without enumerating TypeBox errors', async () => {
			const r = await run('production')

			expect(r.nestedCustomError.status).toBe(422)
			expect(r.nestedCustomError.body.message).toBe(
				'age must be a number'
			)
			expect(r.customErrorWithoutErrorEnumeration.status).toBe(422)
			expect(r.customErrorWithoutErrorEnumeration.body.message).toBe(
				'from findCustomError'
			)
			expect(
				r.customErrorWithoutErrorEnumeration.body.found
			).toBeUndefined()
		})

		it('returns a generic 500 without echoing an invalid server response', async () => {
			const r = await run('production')

			expect(r.maskedResponse.status).toBe(500)
			expect(r.maskedResponse.body.type).toBe('internal-server-error')
			expect(r.maskedResponse.body.status).toBe(500)
			expect(r.maskedResponse.body.found).toBeUndefined()
			expect(r.maskedResponse.body.errors).toBeUndefined()
			expect(JSON.stringify(r.maskedResponse.body)).not.toContain(
				'SECRET'
			)
			expect(JSON.stringify(r.maskedResponse.body)).not.toContain(
				'passwordHash'
			)
		})

		it('does not pass an invalid server response to a custom error callback', async () => {
			const r = await run('production')

			expect(r.maskedResponseCustomError.status).toBe(500)
			expect(
				JSON.stringify(r.maskedResponseCustomError.body)
			).not.toContain('SECRET_TOKEN')
		})

		it('restores response details when allowUnsafeValidationDetails is enabled', async () => {
			const r = await run('production')

			expect(r.unsafeResponse.status).toBe(422)
			expect(r.unsafeResponse.body.on).toBe('response')
		})

		it('names the failing request field without echoing input', async () => {
			const r = await run('production')

			expect(r.maskedRequestProperty.status).toBe(422)
			expect(r.maskedRequestProperty.body.property).toBe('/x')
			expect(r.maskedRequestProperty.body.found).toBeUndefined()
			expect(r.maskedRequestProperty.body.errors).toBeUndefined()
			expect(r.maskedRequestProperty.body.expected).toBeUndefined()
		})

		it('only derives property from structured instance paths', async () => {
			const r = await run('production')

			expect(r.freeTextPath.status).toBe(422)
			expect(r.freeTextPath.body.property).toBe('root')
			expect(JSON.stringify(r.freeTextPath.body)).not.toContain(
				'secret field'
			)
			expect(r.freeTextPath.body.type).toBe('validation')
			expect(r.instancePath.status).toBe(422)
			expect(r.instancePath.body.property).toBe('/x')
		})
	})

	describe('Standard Schema path formatting', () => {
		it('renders object path segments as a JSON pointer in payload.property', async () => {
			const r = await run('production')

			expect(r.standardPathInPayload.status).toBe(422)
			expect(r.standardPathInPayload.body.property).toBe('/user/name')
			expect(r.standardPathInPayload.body.property).not.toContain(
				'[object Object]'
			)
		})

		it('renders object path segments as dotted paths in error.all', async () => {
			for (const env of ['production', 'development']) {
				const r = await run(env)
				expect(Array.isArray(r.standardPathInAll.body)).toBe(true)
				expect(r.standardPathInAll.body[0].path).toBe('user.name')
				expect(r.standardPathInAll.body[0].path).not.toContain(
					'[object Object]'
				)
			}
		})
	})

	describe('development detail', () => {
		it('includes full request and response validation details', async () => {
			const r = await run('development')

			expect(r.maskedRequest.body.property).toBeDefined()
			expect(r.maskedRequest.body.errors).toBeArray()
			expect(r.maskedResponse.status).toBe(422)
			expect(r.maskedResponse.body.on).toBe('response')
			expect(r.maskedResponse.body.errors).toBeArray()
		})

		it('bounds the serialized found value by UTF-8 bytes', async () => {
			const r = await run('development')
			const found = JSON.stringify(
				r.oversizedMultibyteInput.body.found ?? ''
			)

			expect(r.oversizedMultibyteInput.status).toBe(422)
			expect(new TextEncoder().encode(found).length).toBeLessThanOrEqual(
				8192
			)
		})

		it('formats failures without replaying user refinements', async () => {
			const r = await run('development')

			expect(r.refinementCallCount.status).toBe(422)
			expect(r.refinementCallCount.body.responseStatus).toBe(422)
			expect(r.refinementCallCount.body.responseBody.errors).toBeArray()
			expect(r.refinementCallCount.body.calls).toBe(1)
			expect(r.patternFailure.status).toBe(422)
			expect(r.patternFailure.body.errors).toBeArray()
			expect(r.patternFailure.body.detail).toContain('pattern')
		})
	})
})
