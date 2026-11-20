// Each lane needs its own process: the signer lane is fixed at import
import { describe, expect, it } from 'bun:test'

describe('a signed cookie written while the response is mapped is never sent unsigned', () => {
	for (const lane of ['jit', 'subtle', 'aot'])
		it(lane, async () => {
			const child = Bun.spawn(
				[
					process.execPath,
					import.meta.dir + '/late-write-sign.fixture.ts',
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
				expect(stdout.trim()).toBe(
					`35 ${lane} late cookie cases passed`
				)
			} finally {
				clearTimeout(timeout)
			}
		})
})
