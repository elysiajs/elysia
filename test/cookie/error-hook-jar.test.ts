import { describe, expect, it } from 'bun:test'

// An error hook is typed with `cookie`, so reading it must not throw when the
// request failed parse, transform or validation before the route built its
// jar: that turns a 422 into a 500. Each lane emits its own catch, and
// WebCrypto must be selected before the HMAC singleton loads, so every lane
// runs in its own process (see the fixture for the cases)
describe('error hooks read cookies on an early error', () => {
	for (const lane of ['jit', 'subtle', 'aot'] as const)
		it(lane, async () => {
			const child = Bun.spawn(
				[
					process.execPath,
					import.meta.dir + '/error-hook-jar.fixture.ts',
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
				// the AOT capture notes its coercing validators, nothing else
				expect(
					stderr
						.split('\n')
						.filter(
							(line) => line && !line.startsWith('[elysia-aot]')
						)
				).toEqual([])
				expect(exit).toBe(0)
				expect(stdout.trim()).toBe(`22 ${lane} error jar cases passed`)
			} finally {
				clearTimeout(timeout)
			}
		})
})
