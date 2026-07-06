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

/**
 * Subprocess pin for the bridge-free frozen validator.
 *
 * The bridge is module-global and, in the shared bun test process, is wired the
 * moment any other test imports `t` (which calls `setupTypebox`). So the ONLY
 * faithful way to test the stripped-compat scenario — where the bridge is never
 * wired — is out of process, in a child that imports the reconstruct machinery
 * but NOT the elysia type barrel.
 *
 * WHY this test exists (intent): it is the regression pin for "a frozen app whose
 * validators are fully baked can still validate when `setupTypebox` is stripped".
 * The child asserts the bridge is genuinely unwired, then validates real
 * requests through `buildFrozenRouteValidator`. It ALSO runs the pre-change code
 * path (`new RouteValidator`, what `Reconstrct.validator` used to do
 * unconditionally) and asserts THAT throws the stripped-bridge error — so the
 * test would fail against the old behavior and documents exactly what the fix
 * rescues.
 */

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

// Capture a body-slot manifest for `schema` (bridge IS wired here — that is fine,
// capture needs the live TypeBox; the CHILD runs unwired).
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

// Serialize a payload for the child. The captured entries are pure data (source
// strings + flags), so they JSON round-trip. The schema is passed as a plain
// literal so the child never needs the TypeBox-wiring type barrel to build it.
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
			// ensure the child does NOT inherit build mode
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

describe('bridge-free frozen validator (subprocess, unwired bridge)', () => {
	// A plain object whose only leaf coerces (t.Number → Numeric, baked into the
	// `cm` check). This is the bridge-free-complete class.
	const SCHEMA = {
		'~kind': 'Object',
		type: 'object',
		properties: {
			name: { '~kind': 'String', type: 'string' },
			age: { '~kind': 'Number', type: 'number' }
		},
		required: ['name', 'age']
	}

	it('validates real requests with the bridge never wired', () => {
		const captured = capture(t.Object({ name: t.String(), age: t.Number() }))
		const file = writePayload(captured, SCHEMA, [
			{ name: 'a', age: 5 }, // accept + echo
			{ name: 'a', age: 5, extra: 1 }, // accept, excess stripped
			{ age: 5 }, // reject (missing name)
			{ name: 'a', age: 'x' } // reject (wrong type)
		])

		const { proc, parsed } = runChild(file)

		expect(proc.status, proc.stderr).toBe(0)
		// scenario proven: the bridge was genuinely unwired in the child
		expect(parsed.BRIDGE).toBe('unwired')

		const result = parsed.RESULT as {
			reconstructed: boolean
			results: Array<{ ok: boolean; value?: unknown; status?: number }>
		}

		expect(result.reconstructed).toBe(true)
		expect(result.results[0]).toEqual({ ok: true, value: { name: 'a', age: 5 } })
		// excess key stripped by the baked Clean
		expect(result.results[1]).toEqual({ ok: true, value: { name: 'a', age: 5 } })
		expect(result.results[2]!.ok).toBe(false)
		expect(result.results[2]!.status).toBe(422)
		expect(result.results[3]!.ok).toBe(false)
		expect(result.results[3]!.status).toBe(422)
	})

	it('the pre-change path (new RouteValidator) throws the stripped-bridge error', () => {
		const captured = capture(t.Object({ name: t.String(), age: t.Number() }))
		const file = writePayload(captured, SCHEMA, [])

		const { proc, parsed } = runChild(file, { OLD_PATH: '1' })

		expect(proc.status, proc.stderr).toBe(0)
		expect(parsed.BRIDGE).toBe('unwired')

		const result = parsed.RESULT as {
			oldPathThrew: boolean
			message: string
		}
		// This is the 500 the fix rescues: without the bridge-free path, the
		// reconstructed route would throw here on its first request.
		expect(result.oldPathThrew).toBe(true)
		expect(result.message).toContain("Typebox module isn't initialized")
	})
})
