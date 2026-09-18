// Warm TypeBox at build only when a route can reach a TypeBox schema.
// Each arm needs a fresh process because TypeBox loads once per process.
import { describe, expect, it } from 'bun:test'

const FIXTURE = new URL('./typebox-build-warm.fixture.ts', import.meta.url)
	.pathname

const run = (...args: string[]) => {
	const proc = Bun.spawnSync({
		cmd: [process.execPath, 'run', FIXTURE, ...args],
		cwd: new URL('../..', import.meta.url).pathname,
		stdout: 'pipe',
		stderr: 'pipe'
	})

	if (proc.exitCode !== 0)
		throw new Error(
			`arm ${args.join(' ')} exited ${proc.exitCode}\n${proc.stderr.toString()}`
		)

	return JSON.parse(proc.stdout.toString().trim().split('\n').at(-1)!)
}

describe('TypeBox graph is loaded at build', () => {
	// The loose limit separates normal noise from TypeBox's startup cost.
	it('does not stall the loop on the first validated request', () => {
		const { maxLag, perRequest } = run('lag') as {
			maxLag: number
			perRequest: number[]
		}

		expect(maxLag).toBeLessThan(25)
		expect(perRequest[0]).toBeLessThan(40)
	})

	it('leaves TypeBox cold for a schema-less app', () => {
		expect(run('loaded:none')).toEqual({ loaded: false })
	})

	// Standard Schema validators do not use TypeBox.
	it('leaves TypeBox cold for a Standard-Schema-only app', () => {
		expect(run('loaded:standard')).toEqual({ loaded: false })
	})

	it('loads TypeBox for a route-level schema', () => {
		expect(run('loaded:typebox')).toEqual({ loaded: true })
	})

	it('loads TypeBox for a guard-injected schema', () => {
		expect(run('loaded:guard')).toEqual({ loaded: true })
	})

	it('loads TypeBox for a macro-injected schema', () => {
		expect(run('loaded:macro')).toEqual({ loaded: true })
	})

	// Model names and response maps require one extra lookup.
	it('loads TypeBox for a .model() reference', () => {
		expect(run('loaded:model-ref')).toEqual({ loaded: true })
	})

	it('loads TypeBox for a status-keyed response schema', () => {
		expect(run('loaded:response-record')).toEqual({ loaded: true })
	})

	// Route tables do not fold macros from guard nodes.
	it('loads TypeBox for a macro on a guard node', () => {
		expect(run('loaded:chain-macro')).toEqual({ loaded: true })
	})

	// Routes snapshot guards at registration, so later guards must stay cold.
	it('leaves TypeBox cold for a guard that reaches no route', () => {
		expect(run('loaded:late-root-guard')).toEqual({ loaded: false })
	})

	// Plugin and root guards live in separate chains.
	it('loads TypeBox for a schema reachable only through the route chain', () => {
		expect(run('loaded:plugin-guard')).toEqual({ loaded: true })
	})

	it('loads TypeBox for a schema reachable only through the root chain', () => {
		expect(run('loaded:root-chain')).toEqual({ loaded: true })
	})
})
