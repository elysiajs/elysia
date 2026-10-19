import { describe, it, expect, afterAll } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Elysia } from '../../src'

// A plugin's `name` + `seed` hash decides whether `.use()` skips it as already
// installed, so two seeds that hash alike silently drop the second plugin
describe('plugin seed identity', () => {
	const runs = async (...seeds: unknown[]) => {
		let count = 0
		const app = new Elysia()

		for (const seed of seeds)
			app.use(
				new Elysia({
					as: 'global',
					name: 'seeded',
					seed
				}).onBeforeHandle(() => {
					count++
				})
			)

		await app.get('/', () => 'ok').handle('/')

		return count
	}

	it('install plugins seeded by distinct closures with the same source', async () => {
		const make = (tag: string) => () => tag

		expect(await runs(make('a'), make('b'))).toBe(2)
	})

	it('deduplicate plugins seeded by the same function', async () => {
		const seed = () => 'shared'

		expect(await runs(seed, seed)).toBe(1)
	})

	it('install plugins seeded by distinct symbols with the same description', async () => {
		expect(await runs(Symbol('a'), Symbol('a'))).toBe(2)
		expect(await runs(Symbol.for('a'), Symbol.for('a'))).toBe(1)
	})
})

// A plugin package may resolve its own Elysia copy, and the parent compares
// the hash that copy computed. Ids handed out per copy all start at 1, so two
// copies give distinct functions the same id and the same function two ids
const dir = mkdtempSync(join(tmpdir(), 'elysia-seed-copies-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

// Bun caches the directory listing: create every path before resolving
writeFileSync(
	join(dir, 'copy.ts'),
	`export { Elysia } from '${join(import.meta.dir, '../../src/index.ts')}'\n`
)
for (const file of ['copy.js', 'legacy.js']) writeFileSync(join(dir, file), '')

const built = await Bun.build({
	entrypoints: [join(dir, 'copy.ts')],
	target: 'bun'
})
if (!built.success) throw built.logs[0]

const bundle = await built.outputs[0]!.text()

// The bundle imports nothing, so each query re-runs the whole copy
async function loadCopy(file: string, code: string, query = '') {
	writeFileSync(join(dir, file), code)

	return (await import(join(dir, file) + query)).Elysia as typeof Elysia
}

// The seed encoding of copies released before the realm-wide registry: every
// copy numbers functions itself. Worst case for a mixed install, its counter
// stands at the number the registry hands out next
const legacySerializeMacroSeed = `function serializeMacroSeed(_key, value) {
  switch (typeof value) {
    case "function": {
      let id = legacyIds.get(value);
      if (id === undefined) legacyIds.set(value, id = ++legacyCounter);
      return "\\x00fn:" + id;
    }
    case "bigint":
      return "\\x00bigint:" + value.toString();
    case "symbol":
      return "\\x00sym:" + String(value);
    case "undefined":
      return "\\x00undefined";
    default:
      return value;
  }
}
const legacyIds = new WeakMap;
let legacyCounter = globalThis["~elysiaSeedIds"]?.next ?? 0;`

describe('plugin seed identity across Elysia copies', () => {
	it('agree on function seeds', async () => {
		const A = await loadCopy('copy.js', bundle, '?a')
		const B = await loadCopy('copy.js', bundle, '?b')
		expect(A).not.toBe(B)
		expect(A).not.toBe(Elysia)

		const make = (tag: string) => () => tag
		const x = make('x')
		const y = make('y')

		const nested = (Copy: typeof Elysia, check: () => string) =>
			new Copy({ name: 'nested', seed: { check } })
		const top = (Copy: typeof Elysia, seed: () => string) =>
			new Copy({ name: 'top', seed })

		const app = new Elysia()
			.use(nested(A, x).get('/nested-x', () => 'x'))
			.use(nested(B, y).get('/nested-y', () => 'y'))
			.use(top(A, x).get('/top-x', () => 'x'))
			.use(top(B, y).get('/top-y', () => 'y'))

		for (const path of ['/nested-x', '/nested-y', '/top-x', '/top-y'])
			expect((await app.handle(path)).status).toBe(200)

		expect(app.has(nested(B, x))).toBe(true)
		expect(app.has(top(B, x))).toBe(true)
	})

	it('never collide with a copy from before the realm registry', async () => {
		const current =
			/^function serializeMacroSeed\(_key, value\) \{$[^]*?^\}$/m
		expect(bundle).toMatch(current)

		const Legacy = await loadCopy(
			'legacy.js',
			bundle.replace(current, legacySerializeMacroSeed)
		)

		const app = new Elysia()
			.use(
				new Legacy({
					name: 'mixed',
					seed: { callback: () => 'old' }
				}).get('/old', () => 'old')
			)
			.use(
				new Elysia({
					name: 'mixed',
					seed: { callback: () => 'new' }
				}).get('/new', () => 'new')
			)

		expect((await app.handle('/old')).status).toBe(200)
		expect((await app.handle('/new')).status).toBe(200)
	})
})
