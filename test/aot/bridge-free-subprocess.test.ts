import '../../src/compile/aot-capture'
import { describe, it, expect, afterEach } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import {
	Compiled,
	beginValidatorCapture,
	endValidatorCapture,
	endHandlerCapture
} from '../../src/compile/aot'

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
	endHandlerCapture()
	delete process.env.ELYSIA_AOT_BUILD

	return captured.filter((c) => c.slot === 'body')
}

function writePayload(captured: unknown, schema: unknown, cases: unknown[]) {
	dir = mkdtempSync(join(tmpdir(), 'ely-bridge-free-'))
	const file = join(dir, 'payload.json')
	writeFileSync(
		file,
		JSON.stringify({ captured, schema, cases, method: METHOD, path: PATH })
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

		const result = parsed.RESULT as {
			liveValidatorThrew: boolean
			message: string
		}
		expect(result.liveValidatorThrew).toBe(true)
		expect(result.message).toContain("Typebox module isn't initialized")
	})
})
