import '../../src/compile/aot-capture'
import { describe, it, expect, afterEach } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { Elysia, t } from '../../src'
import { validationPlan } from '../../src/experimental/validation-plan'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import { createAppPlanAotPayload } from '../../src/compile/app-plan-aot'
import {
	beginValidatorCapture,
	endValidatorCapture
} from '../../src/compile/aot-capture'
import { captureArtifacts } from '../../src/plugin/aot/source'

/** A child process proves frozen validation works before TypeBox is initialized. */

const CHILD = resolve(import.meta.dir, 'fixtures/bridge-free-child.ts')
const METHOD = 'POST'
const PATH = '/x'

let dir: string | undefined

afterEach(() => {
	delete process.env.ELYSIA_AOT_BUILD
	Compiled.clear()
	Validator.clear()
	if (dir) {
		rmSync(dir, { recursive: true, force: true })
		dir = undefined
	}
})

function capture(schema: any) {
	process.env.ELYSIA_AOT_BUILD = '1'
	beginValidatorCapture()

	const app = new Elysia().post(PATH, { body: schema }, ({ body }) => body)
	;(app as any).compile()

	const captured = endValidatorCapture()
	delete process.env.ELYSIA_AOT_BUILD

	return captured.filter((c) => c.slot === 'body')
}

function captureQuery(schema: any) {
	process.env.ELYSIA_AOT_BUILD = '1'
	beginValidatorCapture()

	const app = new Elysia({ experimental: { validationPlan } }).get(
		PATH,
		{ query: schema },
		({ query }) => query
	)
	;(app as any).compile()

	const captured = endValidatorCapture()
	delete process.env.ELYSIA_AOT_BUILD

	return captured.filter((c) => c.slot === 'query')
}

async function captureWS(schema: any) {
	const artifacts = await captureArtifacts(new Elysia().ws(PATH, {
		body: schema,
		message() {}
	}))
	const plan = artifacts.appPlan!
	return {
		validators: artifacts.validators.filter(
			(c) => c.method === 'WS' && c.slot === 'body'
		),
		registration: {
			fingerprint: artifacts.fingerprint,
			payload: createAppPlanAotPayload(plan),
			identity: plan.wsRoutes[0]!.validators[0]!
		}
	}
}

function writePayload(
	captured: unknown,
	schema: unknown,
	cases: unknown[],
	method = METHOD,
	slot: 'body' | 'query' = 'body',
	registration?: unknown
) {
	dir = mkdtempSync(join(tmpdir(), 'ely-bridge-free-'))
	const file = join(dir, 'payload.json')
	writeFileSync(
		file,
		JSON.stringify({
			captured,
			schema,
			cases,
			method,
			path: PATH,
			slot,
			registration
		})
	)
	return file
}

function runChild(payloadFile: string, env: Record<string, string> = {}) {
	const proc = spawnSync('bun', [CHILD], {
		env: {
			...process.env,
			PAYLOAD: payloadFile,
			ELYSIA_AOT_BUILD: '',
			...env
		},
		encoding: 'utf8'
	})

	const lines = (proc.stdout ?? '').trim().split('\n').filter(Boolean)
	const parsed: Record<string, unknown> = {}
	for (const line of lines) {
		const sp = line.indexOf(' ')
		if (sp === -1) continue
		try {
			parsed[line.slice(0, sp)] = JSON.parse(line.slice(sp + 1))
		} catch {}
	}

	return { proc, parsed }
}

describe('frozen validation without a TypeBox bridge', () => {
	const SCHEMA = {
		'~kind': 'Object',
		type: 'object',
		properties: {
			name: { '~kind': 'String', type: 'string' },
			age: { '~kind': 'Number', type: 'number' }
		},
		required: ['name', 'age']
	}

	it('validates and cleans real requests in an unwired process', () => {
		const captured = capture(
			t.Object({ name: t.String(), age: t.Number() })
		)
		const file = writePayload(captured, SCHEMA, [
			{ name: 'a', age: 5 },
			{ name: 'a', age: 5, extra: 1 },
			{ age: 5 },
			{ name: 'a', age: 'x' }
		])

		const { proc, parsed } = runChild(file)

		expect(proc.status, proc.stderr).toBe(0)
		expect(parsed.BRIDGE).toBe('unwired')
		expect(parsed.READY).toBe(false)

		const result = parsed.RESULT as {
			reconstructed: boolean
			results: Array<{ ok: boolean; value?: unknown; status?: number }>
		}

		expect(result.reconstructed).toBe(true)
		expect(result.results[0]).toEqual({
			ok: true,
			value: { name: 'a', age: 5 }
		})
		expect(result.results[1]).toEqual({
			ok: true,
			value: { name: 'a', age: 5 }
		})
		expect(result.results[2]!.ok).toBe(false)
		expect(result.results[2]!.status).toBe(422)
		expect(result.results[3]!.ok).toBe(false)
		expect(result.results[3]!.status).toBe(422)
	})

	it('confirms the ordinary validator requires an initialized bridge', () => {
		const captured = capture(
			t.Object({ name: t.String(), age: t.Number() })
		)
		const file = writePayload(captured, SCHEMA, [])

		const { proc, parsed } = runChild(file, { USE_LIVE_VALIDATOR: '1' })

		expect(proc.status, proc.stderr).toBe(0)
		expect(parsed.BRIDGE).toBe('unwired')
		expect(parsed.READY).toBe(false)

		const result = parsed.RESULT as {
			liveValidatorThrew: boolean
			message: string
		}
		expect(result.liveValidatorThrew).toBe(true)
		expect(result.message).toContain("Typebox module isn't initialized")
	})

	it('reconstructs before the ordinary validator can touch the bridge', () => {
		const schema = t.Object({ id: t.String() })
		const captured = captureQuery(schema)
		const file = writePayload(
			captured,
			{
				'~kind': 'Object',
				type: 'object',
				properties: {
					id: { '~kind': 'String', type: 'string' }
				},
				required: ['id']
			},
			['id=ok'],
			'GET',
			'query'
		)

		const { proc, parsed } = runChild(file, {
			USE_RECONSTRUCT_VALIDATOR: '1'
		})

		expect(proc.status, proc.stderr).toBe(0)
		expect(parsed.BRIDGE).toBe('unwired')
		expect(parsed.READY).toBe(false)
		expect(parsed.RESULT).toEqual({
			reconstructed: true,
			routeValidatorTouched: false,
			results: [{ ok: true, value: { id: 'ok' } }]
		})
	})

	it('rejects an approximate WS schema before unwired validator construction', async () => {
		const captured = await captureWS(t.Object({ message: t.String() }))
		const file = writePayload(
			captured.validators,
			{
				'~kind': 'Object',
				type: 'object',
				properties: {
					message: { '~kind': 'String', type: 'string' }
				},
				required: ['message']
			},
			[],
			'WS',
			'body',
			captured.registration
		)

		const { proc, parsed } = runChild(file, { USE_WS_BUILD: '1' })

		expect(proc.status).not.toBe(0)
		expect(proc.stderr).toContain('AppPlan fingerprint mismatch')
		expect(parsed.BRIDGE).toBe('unwired')
		expect(parsed.READY).toBe(false)
		expect(parsed.READY_BEFORE_BUILD).toBe(false)
		expect(parsed.RESULT).toBeUndefined()
	})

	it('rebuilds an experimental query plan in an unwired process', () => {
		const schema = t.Object({ id: t.Array(t.String()) })
		const captured = captureQuery(schema)
		const file = writePayload(
			captured,
			{
				'~kind': 'Object',
				type: 'object',
				properties: {
					id: {
						'~kind': 'Array',
						type: 'array',
						items: { '~kind': 'String', type: 'string' }
					}
				},
				required: ['id']
			},
			['id=a&id=b'],
			'GET',
			'query'
		)

		const { proc, parsed } = runChild(file)

		expect(proc.status, proc.stderr).toBe(0)
		expect(parsed.BRIDGE).toBe('unwired')
		expect(parsed.READY).toBe(false)
		expect(parsed.RESULT).toEqual({
			reconstructed: true,
			routeValidatorTouched: false,
			results: [{ ok: true, value: { id: ['a', 'b'] } }]
		})
	})
})
