import { describe, it, expect, afterEach } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { Elysia, t } from '../../src'
import { Validator } from '../../src/validator'
import { Compiled } from '../../src/compile/aot'
import {
	beginValidatorCapture,
	endValidatorCapture,
	endHandlerCapture
} from '../../src/compile/aot-capture'

/**
 * `Reconstrct.validator` (src/compile/handler/reconstruct.ts) branches on
 * `!isBridgeLive()`. Once any file in a `bun test` run imports `t` from
 * 'elysia', the bridge is wired for the rest of that process (see
 * src/type/index.ts's top-level `setupTypebox()`), so the only reliable way
 * to exercise the bridge-not-live branches is a fresh child process — the
 * same pattern test/aot/bridge-free-subprocess.test.ts uses.
 */

const CHILD = resolve(
	import.meta.dir,
	'fixtures/reconstruct-bridge-free-child.ts'
)
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

function writePayload(captured: unknown, schema: unknown) {
	dir = mkdtempSync(join(tmpdir(), 'ely-reconstruct-bridge-free-'))
	const file = join(dir, 'payload.json')
	writeFileSync(
		file,
		JSON.stringify({ captured, schema, method: METHOD, path: PATH })
	)
	return file
}

function runChild(payloadFile: string) {
	const proc = spawnSync('bun', [CHILD], {
		env: { ...process.env, PAYLOAD: payloadFile, ELYSIA_AOT_BUILD: '' },
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

describe('Reconstrct.validator without a TypeBox bridge', () => {
	it('returns a frozen validator at the detour site (reconstruct.ts:27-28), without wiring the bridge', () => {
		const SCHEMA = {
			'~kind': 'Object',
			type: 'object',
			properties: {
				name: { '~kind': 'String', type: 'string' },
				age: { '~kind': 'Number', type: 'number' }
			},
			required: ['name', 'age']
		}

		const captured = capture(
			t.Object({ name: t.String(), age: t.Number() })
		)
		const file = writePayload(captured, SCHEMA)

		const { proc, parsed } = runChild(file)

		expect(proc.status, proc.stderr).toBe(0)
		expect(parsed.BRIDGE).toBe('unwired')
		expect(parsed.LIVE).toBe(false)

		const result = parsed.RESULT as {
			threw: boolean
			reconstructed: boolean
			liveAfter: boolean
		}
		expect(result.threw).toBe(false)
		expect(result.reconstructed).toBe(true)
		// the fast path must not have side-wired the bridge
		expect(result.liveAfter).toBe(false)
	})

	it('re-throws the original bridge error when reconstruction is impossible both times (reconstruct.ts:43-49)', () => {
		// A union member cannot be reconstructed bridge-free (see
		// test/aot/bridge-free-validator.test.ts's "requires TypeBox" cases),
		// so `buildFrozenRouteValidator` fails identically on both the initial
		// attempt (line 27) and the catch-block retry (line 46): the retry's
		// `if (frozen) return frozen` (line 47) can never go true here, since
		// it is a deterministic re-call with unchanged inputs.
		const SCHEMA = {
			'~kind': 'Object',
			type: 'object',
			properties: {
				v: { '~kind': 'Union' }
			},
			required: ['v']
		}

		const captured = capture(
			t.Object({ v: t.Union([t.String(), t.Number()]) })
		)
		const file = writePayload(captured, SCHEMA)

		const { proc, parsed } = runChild(file)

		expect(proc.status, proc.stderr).toBe(0)
		expect(parsed.BRIDGE).toBe('unwired')
		expect(parsed.LIVE).toBe(false)

		const result = parsed.RESULT as {
			threw: boolean
			message: string
			liveAfter: boolean
		}
		expect(result.threw).toBe(true)
		expect(result.message).toContain("Typebox module isn't initialized")
		expect(result.liveAfter).toBe(false)
	})
})
