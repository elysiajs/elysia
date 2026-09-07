import { describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

/**
 * `isCloudflareWorker` is computed once at module load, so the only way to
 * observe both branches is a subprocess with the workerd global pre-set
 * before `exact-mirror.ts` is ever imported.
 */
describe('exact-mirror under workerd', () => {
	it('skips the require probe when a workerd global is present', () => {
		const src = resolve(import.meta.dir, '../../src')
		const script =
			`;(globalThis as any).WebSocketPair = class {}\n` +
			`import { getExactMirror } from '${src}/type/validator/exact-mirror.ts'\n` +
			`console.log(JSON.stringify({ mirror: getExactMirror() }))\n`

		const child = spawnSync('bun', ['-e', script], { encoding: 'utf8' })

		expect(child.status).toBe(0)
		expect(JSON.parse(child.stdout.trim())).toEqual({})
	})

	it('still resolves the real mirror off workerd', () => {
		const src = resolve(import.meta.dir, '../../src')
		const script =
			`import { getExactMirror } from '${src}/type/validator/exact-mirror.ts'\n` +
			`console.log(typeof getExactMirror())\n`

		const child = spawnSync('bun', ['-e', script], { encoding: 'utf8' })

		expect(child.status).toBe(0)
		expect(child.stdout.trim()).toBe('function')
	})
})
