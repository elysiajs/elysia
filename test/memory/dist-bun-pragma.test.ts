import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'

const dist = resolve(import.meta.dir, '../../dist')

const walk = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory()
			? walk(join(dir, entry.name))
			: [join(dir, entry.name)]
	)

// Same predicate as the `bun-pretranspiled-pragma` plugin in build.ts
const needsTranspiler =
	/(?<![.\w])require\s*\(|require\.resolve|__dirname|__filename|process\.env/

const PRAGMA = '// @bun\n'

/**
 * Bun skips its transpiler for a file that opens with `// @bun`, the header
 * `bun build --target bun` emits: about 3 MB less RSS to import the per-file
 * dist. The transpiler is also what gives an ESM file `require` and
 * `__dirname` and what applies a runtime `--define` to `process.env`, so a
 * marked file must never reach for them, and a CommonJS file must never be
 * marked: without the transpiler it runs as a module with no `exports`.
 * Bun reads a marked file as Latin-1, so it has to be pure ASCII or an em
 * dash in an error message comes out as mojibake
 */
describe('dist `// @bun` pragma', () => {
	const files = walk(dist)
	const esm = files.filter((file) => file.endsWith('.mjs'))
	const read = (file: string) => readFileSync(file, 'utf8')
	const marked = esm.filter((file) => read(file).startsWith(PRAGMA))

	it('marks every ESM file that does not need the transpiler', () => {
		const unmarked = esm.filter(
			(file) =>
				!read(file).startsWith(PRAGMA) &&
				!needsTranspiler.test(read(file))
		)

		expect(unmarked).toEqual([])
		expect(marked.length).toBeGreaterThan(esm.length / 2)
	})

	it('never marks a file that needs the transpiler', () => {
		expect(
			marked.filter((file) => needsTranspiler.test(read(file)))
		).toEqual([])
	})

	it('keeps every marked file ASCII, as Bun reads it as Latin-1', () => {
		expect(marked.filter((file) => /[^\x00-\x7f]/.test(read(file)))).toEqual(
			[]
		)
	})

	it('never marks CommonJS', () => {
		expect(
			files.filter(
				(file) => file.endsWith('.js') && read(file).startsWith('// @bun')
			)
		).toEqual([])
	})

	it('every marked file still loads without the transpiler', () => {
		const proc = Bun.spawnSync({
			cmd: [
				process.execPath,
				'-e',
				`const failed = []\n` +
					`for (const file of ${JSON.stringify(marked)})\n` +
					`\ttry { await import(file) } catch (e) { failed.push([file, e.name, e.message]) }\n` +
					`console.log(JSON.stringify(failed))`
			],
			stdout: 'pipe',
			stderr: 'pipe'
		})

		expect(proc.stderr.toString()).toBe('')

		const failed = JSON.parse(proc.stdout.toString()) as [
			string,
			string,
			string
		][]

		// the one import-time refusal is the AOT worker entry, which needs its
		// parent port; anything else here is a transpiler-provided global gone
		expect(
			failed.map(([file, name]) => [relative(dist, file), name])
		).toEqual([['plugin/aot/worker.mjs', 'Error']])
	})

	// pins the mechanism the build relies on: a marked file reaches JSC as-is
	it('Bun honors the pragma by skipping its transpiler', () => {
		const dir = mkdtempSync(join(tmpdir(), 'elysia-pragma-'))
		const file = join(dir, 'typed.mjs')
		writeFileSync(file, PRAGMA + 'let typed: number = 1\nexport default typed\n')

		const proc = Bun.spawnSync({
			cmd: [process.execPath, file],
			stdout: 'pipe',
			stderr: 'pipe'
		})

		// without the pragma Bun's transpiler strips the annotation and this runs
		expect(proc.exitCode).not.toBe(0)
		expect(proc.stderr.toString()).toContain('SyntaxError')
	})
})
