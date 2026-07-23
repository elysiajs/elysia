import { describe, expect, it } from 'bun:test'

const fixture = new URL(
	'./public-app-plan-retention.fixture.ts',
	import.meta.url
).pathname

describe('published AppPlan reachability', () => {
	it('retains runtime artifacts without retaining framework authoring state', () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, fixture],
			stdout: 'pipe',
			stderr: 'pipe'
		})
		const stderr = new TextDecoder().decode(result.stderr)
		expect(result.exitCode, stderr).toBe(0)
		const output = JSON.parse(new TextDecoder().decode(result.stdout)) as any

		expect(output.aliveForbidden).toEqual([])
		expect(output.sessionAlive).toBeFalse()
		// User-supplied closure graphs are opaque external bindings and explicitly
		// outside the framework reachability claim.
		expect(output.opaqueUserBindingAlive).toBeTrue()
		expect(output.artifacts).toEqual({
			generationFrozen: true,
			planRetained: false,
			plannedHttpRoutes: 7,
			compiledHandler: 'function',
			activeCompilerSession: false
		})
		expect(output.behavior).toEqual({
			valid: '7',
			invalidStatus: 422,
			invalidResponseStatus: 500,
			thrownStatus: 500,
			marker: 'opaque-user-binding'
		})
	})
})
