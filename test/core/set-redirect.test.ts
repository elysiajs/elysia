// Reject removed `set.redirect` in development so it cannot expose protected data.

import { describe, it, expect } from 'bun:test'
import { Elysia } from '../../src'
import { aotReconstructHandle } from '../differential/lanes'

const MESSAGE =
	'[Elysia] set.redirect was removed in 2.0 — return redirect(url) instead'

const secret = ({ set }: any) => {
	set.redirect = '/signin'
	return 'THE SECRET'
}

const req = () => new Request('http://localhost/secret')

const expectLoud = async (response: Response) => {
	expect(response.status).toBe(500)

	const body = await response.text()
	// Never expose the protected body.
	expect(body).not.toContain('THE SECRET')
	expect(body).toContain(MESSAGE)
}

// NODE_ENV is read at module load, so test each mode in a child process.
const FIXTURE = new URL('./set-redirect.fixture.ts', import.meta.url).pathname

type LaneReport = Record<string, { status: number; body: string }>

const runFixture = async (
	nodeEnv: string,
	lateProduction = false
): Promise<LaneReport> => {
	const proc = Bun.spawn(['bun', 'run', FIXTURE], {
		env: {
			...process.env,
			NODE_ENV: nodeEnv,
			...(lateProduction ? { ELYSIA_TEST_LATE_PROD: '1' } : {})
		},
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

	return JSON.parse(stdout.trim()) as LaneReport
}

// Other suites may change NODE_ENV after the guard reads it.
const guardIsArmed =
	(
		await new Elysia()
			.get('/probe', ({ set }: any) => {
				set.redirect = '/signin'
				return 'probe'
			})
			.handle('/probe')
	).status === 500

const devIt = guardIsArmed ? it : it.skip

describe('set.redirect is loud in development', () => {
	it('is loud in a development process, whichever mode this process is in', async () => {
		const lanes = await runFixture('development')

		expect(Object.keys(lanes).sort()).toEqual(['dispatch', 'inline', 'jit'])

		for (const [lane, result] of Object.entries(lanes)) {
			expect(`${lane}:${result.status}`).toBe(`${lane}:500`)
			expect(result.body).not.toContain('THE SECRET')
			expect(result.body).toContain(MESSAGE)
		}
	})

	devIt(
		'throws on the dispatch lane (a request hook writes set.redirect)',
		async () => {
			const app = new Elysia()
				.request(secret)
				.get('/secret', () => 'plain')

			await expectLoud(await app.handle(req()))
		}
	)

	devIt(
		'throws on the inline-with-set lane (hook-less handler)',
		async () => {
			const app = new Elysia().get('/secret', secret)
			app.compile()

			await expectLoud(await app.handle(req()))
		}
	)

	devIt(
		'throws on the JIT codegen lane (a lifecycle hook leaves the inline path)',
		async () => {
			const app = new Elysia()
				.beforeHandle(() => {})
				.get('/secret', secret)
			app.compile()

			await expectLoud(await app.handle(req()))
		}
	)

	devIt('throws on the AOT capture lane', async () => {
		const lane = await aotReconstructHandle.make((app) =>
			app.get('/secret', secret)
		)

		try {
			await expectLoud(await lane.handle(req()))
		} finally {
			await lane.dispose()
		}
	})

	devIt(
		'throws once — the 500 it produces is mapped through the same set',
		async () => {
			let errors = 0
			const app = new Elysia()
				.error(() => {
					errors++
				})
				.get('/secret', secret)

			expect((await app.handle(req())).status).toBe(500)
			// Mapping the error response must not re-enter the error pipeline.
			expect(errors).toBe(1)
		}
	)

	it('does not fire for the v2 replacement or for an untouched set', async () => {
		const app = new Elysia()
			.get('/ok', ({ redirect }) => redirect('/signin'))
			.get('/set', ({ set }) => {
				set.status = 201
				set.headers['x-test'] = 'a'
				return 'fine'
			})

		const redirected = await app.handle(new Request('http://localhost/ok'))
		expect(redirected.status).toBe(302)
		expect(redirected.headers.get('location')).toBe('/signin')

		const plain = await app.handle(new Request('http://localhost/set'))
		expect(plain.status).toBe(201)
		expect(await plain.text()).toBe('fine')
	})
})

describe('set.redirect in production', () => {
	it('is not guarded — production behaviour is unchanged', async () => {
		const lanes = await runFixture('production')

		expect(Object.keys(lanes).sort()).toEqual(['dispatch', 'inline', 'jit'])

		for (const [lane, result] of Object.entries(lanes)) {
			expect(`${lane}:${result.status}`).toBe(`${lane}:200`)
			expect(`${lane}:${result.body}`).toBe(`${lane}:THE SECRET`)
		}
	})

	// Late production setup must disable the development-only guard.
	it('stands down when NODE_ENV is assigned after the import', async () => {
		const lanes = await runFixture('development', true)

		expect(Object.keys(lanes).sort()).toEqual(['dispatch', 'inline', 'jit'])

		for (const [lane, result] of Object.entries(lanes)) {
			expect(`${lane}:${result.status}`).toBe(`${lane}:200`)
			expect(`${lane}:${result.body}`).toBe(`${lane}:THE SECRET`)
		}
	})
})
