import { describe, it, expect, afterAll } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// TypeBox is loaded lazily on first use. When that load went through an opaque
// `import.meta.require`, a plain `bun build` (no AOT plugin) left TypeBox out of
// the bundle: deployed without node_modules, every validated route answered 500
// "Cannot find module 'typebox/type'" while unvalidated routes kept working.
// exact-mirror had the same loader: explicit `normalize: 'exactMirror'` 500'd.
//
// The bundle runs from a temp dir with --no-install: with no node_modules above
// it, Bun would otherwise auto-install TypeBox from its cache and hide the bug.
// dist is covered too: its build must keep the literal `require` bundlers follow

const root = join(import.meta.dir, '..', '..')
const dir = mkdtempSync(join(tmpdir(), 'elysia-plain-bundle-'))

afterAll(() => rmSync(dir, { recursive: true, force: true }))

const app = (from: string) => `
import { Elysia, t } from '${from}'

const app = new Elysia({ normalize: 'exactMirror' })
	.post('/json', { body: t.Object({ name: t.String() }) }, ({ body }) => body)
	.get(
		'/mirror',
		{ response: t.Object({ name: t.String() }) },
		() => ({ name: 'a', secret: 'b' }) as any
	)

const ok = await app.handle(new Request('http://e.ly/json', {
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify({ name: 'a' })
}))
const invalid = await app.handle(new Request('http://e.ly/json', {
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify({ name: 1 })
}))

const mirror = await app.handle(new Request('http://e.ly/mirror'))

console.log(JSON.stringify([
	ok.status,
	await ok.text(),
	invalid.status,
	mirror.status,
	await mirror.text()
]))
`

describe('plain bundle embeds TypeBox and exact-mirror', () => {
	for (const [name, from] of [
		['src', join(root, 'src', 'index.ts')],
		['dist', join(root, 'dist', 'index.mjs')]
	])
		it(`validates without node_modules (${name})`, async () => {
			const entry = join(dir, `${name}.ts`)
			writeFileSync(entry, app(from))

			const built = await Bun.build({
				entrypoints: [entry],
				outdir: join(dir, name),
				target: 'bun'
			})
			expect(built.success).toBe(true)

			const run = Bun.spawnSync({
				cmd: [process.execPath, '--no-install', built.outputs[0]!.path],
				cwd: dir
			})

			expect(run.stderr.toString()).toBe('')
			expect(JSON.parse(run.stdout.toString())).toEqual([
				200,
				'{"name":"a"}',
				422,
				200,
				'{"name":"a"}'
			])
		})
})

// listen() preloads TypeBox asynchronously. With a computed `import()` a bundled
// server ignored its embedded copy and loaded a second TypeBox from whatever
// node_modules sat next to it (+40 ms, +20 MB, two TypeBox instances). Here that
// node_modules holds a decoy that announces itself if it is ever evaluated
const listenApp = (from: string) => `
import { Elysia, t } from '${from}'

const app = new Elysia()
	.post('/json', { body: t.Object({ name: t.String() }) }, ({ body }) => body)
	.listen(0, async (server) => {
		const response = await fetch(new URL('/json', server.url), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: 'a' })
		})
		console.log(JSON.stringify([response.status, await response.text()]))
		await app.stop()
	})
`

describe('bundled server uses its embedded TypeBox', () => {
	const decoy = join(dir, 'decoy')
	mkdirSync(join(decoy, 'node_modules', 'typebox'), { recursive: true })
	writeFileSync(
		join(decoy, 'node_modules', 'typebox', 'package.json'),
		JSON.stringify({
			name: 'typebox',
			type: 'module',
			exports: { './*': './decoy.js' }
		})
	)
	writeFileSync(
		join(decoy, 'node_modules', 'typebox', 'decoy.js'),
		`console.log('DECOY TYPEBOX LOADED')\n`
	)

	for (const [name, from] of [
		['src', join(root, 'src', 'index.ts')],
		['dist', join(root, 'dist', 'index.mjs')]
	])
		it(`does not load node_modules TypeBox on listen (${name})`, async () => {
			const entry = join(decoy, `${name}.ts`)
			writeFileSync(entry, listenApp(from))

			const built = await Bun.build({
				entrypoints: [entry],
				outdir: join(decoy, name),
				target: 'bun'
			})
			expect(built.success).toBe(true)

			const run = Bun.spawnSync({
				cmd: [process.execPath, '--no-install', built.outputs[0]!.path],
				cwd: decoy,
				timeout: 10_000
			})

			expect(run.stdout.toString()).not.toContain('DECOY')
			expect(JSON.parse(run.stdout.toString())).toEqual([
				200,
				'{"name":"a"}'
			])
		})
})
