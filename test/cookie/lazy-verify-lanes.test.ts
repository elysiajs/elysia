import { describe, expect, it } from 'bun:test'

const run = async (lane: 'subtle' | 'aot') => {
	const child = Bun.spawn(
		[
			process.execPath,
			import.meta.dir + '/lazy-verify-lanes.fixture.ts',
			lane
		],
		{ stdout: 'pipe', stderr: 'pipe' }
	)
	const timeout = setTimeout(() => child.kill(), 10_000)
	try {
		const [exit, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text()
		])
		expect(stderr).toBe('')
		expect(exit).toBe(0)
		// subtle adds the two WebSocket upgrade cases
		expect(stdout.trim()).toBe(
			`${lane === 'subtle' ? 29 : 27} lazy verification cases passed`
		)
	} finally {
		clearTimeout(timeout)
	}
}

describe("verify: 'lazy' on lanes without on-access verification", () => {
	it('defers rejection to the first read with WebCrypto', () => run('subtle'))
	it('defers rejection to the first read on AOT', () => run('aot'))
})
