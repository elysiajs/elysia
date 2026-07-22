import { describe, expect, it } from 'bun:test'

const fixture = new URL('./retention-seal.fixture.ts', import.meta.url).pathname
const failureFixture = new URL(
	'./retention-seal-failure.fixture.ts',
	import.meta.url
).pathname
const transactionFixture = new URL(
	'./retention-seal-transaction.fixture.ts',
	import.meta.url
).pathname

function run(image: 'strict' | 'introspect') {
	const result = Bun.spawnSync({
		cmd: [process.execPath, fixture, `--image=${image}`],
		stdout: 'pipe',
		stderr: 'pipe'
	})
	const stderr = new TextDecoder().decode(result.stderr)
	expect(result.exitCode, stderr).toBe(0)
	return JSON.parse(new TextDecoder().decode(result.stdout)) as any
}

describe('N+3a retention images', () => {
	it('does not publish a generation when validator sealing fails', () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, transactionFixture],
			stdout: 'pipe',
			stderr: 'pipe'
		})
		const stderr = new TextDecoder().decode(result.stderr)
		expect(result.exitCode, stderr).toBe(0)
		const output = JSON.parse(new TextDecoder().decode(result.stdout))

		expect(output).toEqual({
			failures: [
				{
					error: 'seal boom',
					generation: false,
					served: 0,
					finalizeRestored: true,
					bindingRestored: true
				},
				{
					error: 'seal boom',
					generation: false,
					served: 0,
					finalizeRestored: true,
					bindingRestored: true
				}
			],
			sealCalls: 3,
			analysisReadsAfterFailure: 5,
			analysisReadsAfterSeal: 10,
			analysisReads: 10,
			served: 1,
			body: 'served',
			generation: true
		})
	})

	it('serves normalize:typebox from the detached runtime image', () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, failureFixture],
			stdout: 'pipe',
			stderr: 'pipe'
		})
		const stderr = new TextDecoder().decode(result.stderr)
		expect(result.exitCode, stderr).toBe(0)
		const output = JSON.parse(new TextDecoder().decode(result.stdout))

		expect(output).toEqual({
			errors: [],
			served: 2,
			bodies: [{ route: 'yes' }, { route: 'yes' }],
			generation: true
		})
	})

	it('strict production publishes only the compact runtime image', () => {
		const output = run('strict')
		expect(output.behavior).toEqual({
			dynamic: '42',
			static: 'static',
			valid: '7',
			invalidStatus: 422,
			thrown: 'boom',
			thrownStatus: 503,
			wsHookStatus: 418,
			wsUpgradeCalls: 1,
			wsUpgradeReturned: false,
			extractedWSHandler: 'function'
		})
		expect(output.coldProbe).toEqual({
			jit: true,
			reasons: []
		})
		expect(output.generation).toMatchObject({
			hasRuntime: true,
			hasIntrospection: false,
			descriptorCacheDropped: true,
			authoringKeys: [],
			hasCompactRouteTable: false,
			compactRouteColumns: [],
			runtimeHasRouteTable: false,
			nativeStaticIdentity: true,
			runtimeKeys: [
				'nativeStatic',
				'server',
				'websocket',
				'~config',
				'~ext',
				'~programId'
			],
			introspectionKeys: []
		})
		expect(output.reachable).toEqual({
			plugin: false,
			schema: false,
			responseSchema: false,
			wsPlugin: false,
			extractedWSRoot: false,
			extractedWSOwner: false
		})
		expect(output.authoring).toEqual({
			routeTableDropped: true,
			routesDropped: true,
			scopeChildrenDropped: true,
			hookChainDropped: true
		})
	})

	it('introspect adds its documented route/history/model diagnostics', () => {
		const output = run('introspect')
		expect(output.behavior).toEqual({
			dynamic: '42',
			static: 'static',
			valid: '7',
			invalidStatus: 422,
			thrown: 'boom',
			thrownStatus: 503,
			wsHookStatus: 418,
			wsUpgradeCalls: 1,
			wsUpgradeReturned: false,
			extractedWSHandler: 'function'
		})
		expect(output.generation).toMatchObject({
			hasRuntime: true,
			hasIntrospection: true,
			descriptorCacheDropped: true,
			authoringKeys: [],
			hasCompactRouteTable: true,
			compactRouteColumns: ['flags', 'length', 'method', 'path'],
			runtimeHasRouteTable: false,
			nativeStaticIdentity: true,
			runtimeKeys: [
				'nativeStatic',
				'server',
				'websocket',
				'~config',
				'~ext',
				'~programId'
			],
			introspectionKeys: ['history', 'models', 'routeTable', 'routes'],
			introspectionModels: ['RetainedResponse'],
			modelsIdentity: true
		})
		expect(output.generation.introspectionRoutes).toBeGreaterThanOrEqual(6)
		expect(output.generation.introspectionHistory).toBeGreaterThanOrEqual(6)
		expect(output.reachable.plugin).toBeFalse()
		expect(output.reachable.wsPlugin).toBeFalse()
		expect(output.reachable.extractedWSRoot).toBeFalse()
		expect(output.reachable.extractedWSOwner).toBeFalse()
		expect(output.authoring).toEqual({
			routeTableDropped: true,
			routesDropped: true,
			scopeChildrenDropped: true,
			hookChainDropped: true
		})
	})
})
