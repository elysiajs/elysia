import { describe, it, expect, afterAll } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// The response mapper dispatches on `Object.getPrototypeOf(x).constructor.name`
// (src/adapter/web-standard/handler.ts) so that a second copy of elysia in
// node_modules — different class objects, same class names — still recognises a
// `form()` / `file()` / `status()` produced by the other copy.
//
// A downstream minifier rewrites `class ElysiaForm {}` to `class G5 {}` but
// never rewrites the `case 'ElysiaForm':` string literal it is compared
// against, so without an explicit `Object.defineProperty(X, 'name', ...)` the
// cross-copy arm goes dead in every minified build and the response falls
// through to `new Response(value)` — body `[object Object]`, content-type null.
//
// Only a real minified build can catch that regression: in unminified source
// `ElysiaFile.name` is already `'ElysiaFile'` whether or not the pin exists,
// and the pin leaves the property descriptor byte-identical. So this file
// bundles two independent minified copies of elysia and makes copy B's mapper
// handle copy A's values.

const src = join(import.meta.dir, '..', '..', 'src')
const dir = mkdtempSync(join(tmpdir(), 'elysia-minified-dispatch-'))

afterAll(() => rmSync(dir, { recursive: true, force: true }))

// Two separate entrypoints => two separate module graphs => two elysia copies,
// exactly like a plugin pinned to a different elysia version in node_modules.
//
// `canary` is a harness self-check: it must come back mangled, otherwise the
// import silently loaded unminified source and every assertion below is vacuous.
const entries = {
	'copy-a':
		`class MinifyCanaryA {}\nexport const canary = MinifyCanaryA\n` +
		`export { form, file, status } from '${join(src, 'index.ts')}'\n` +
		`export { Cookie } from '${join(src, 'cookie', 'cookie.ts')}'\n`,
	'copy-b':
		`class MinifyCanaryB {}\nexport const canary = MinifyCanaryB\n` +
		`export { mapCompactResponse } from '${join(src, 'adapter', 'web-standard', 'handler.ts')}'\n`
}

const fixture = join(dir, 'hello.txt')

// Every path has to exist before the first resolve: Bun caches the directory
// listing, and an `import('…/copy-a.js')` of a file created after that point
// silently falls back to `copy-a.ts` — i.e. to unminified source.
writeFileSync(fixture, 'hello world')
for (const name in entries) {
	writeFileSync(
		join(dir, `${name}.ts`),
		entries[name as keyof typeof entries]
	)
	writeFileSync(join(dir, `${name}.js`), '')
}

for (const name in entries) {
	const built = await Bun.build({
		entrypoints: [join(dir, `${name}.ts`)],
		target: 'bun',
		minify: true
	})

	if (!built.success) throw built.logs[0]

	writeFileSync(join(dir, `${name}.js`), await built.outputs[0]!.text())
}

const copyA = await import(join(dir, 'copy-a.js'))
const copyB = await import(join(dir, 'copy-b.js'))

const tag = (value: unknown) => Object.getPrototypeOf(value)?.constructor?.name

describe('response dispatch survives a downstream minifier', () => {
	it('really loaded minified bundles', () => {
		expect(copyA.canary.name).not.toBe('MinifyCanaryA')
		expect(copyB.canary.name).not.toBe('MinifyCanaryB')
	})

	it('keeps the dispatched class names as string literals after minify', () => {
		// Without the pin these read as mangled single letters, e.g. `n`, `I`, `c`.
		expect(tag(copyA.form({ a: 'b' }))).toBe('ElysiaForm')
		expect(tag(copyA.file(fixture))).toBe('ElysiaFile')
		expect(tag(copyA.status(418, 'teapot'))).toBe('ElysiaStatus')
		expect(tag(new copyA.Cookie('a', {}))).toBe('Cookie')
	})

	it("maps another minified copy's form to multipart, not [object Object]", async () => {
		const res: Response = await copyB.mapCompactResponse(
			copyA.form({ a: 'b' })
		)

		expect(String(res.headers.get('content-type'))).toContain(
			'multipart/form-data'
		)
		await expect(res.text()).resolves.toContain('name="a"')
	})

	it("maps another minified copy's file to its content, not [object Object]", async () => {
		const res: Response = await copyB.mapCompactResponse(
			copyA.file(fixture)
		)

		expect(String(res.headers.get('content-type'))).toContain('text/plain')
		await expect(res.text()).resolves.toBe('hello world')
	})

	it("applies another minified copy's status code and body", async () => {
		const res: Response = await copyB.mapCompactResponse(
			copyA.status(418, 'teapot')
		)

		expect(res.status).toBe(418)
		await expect(res.text()).resolves.toBe('teapot')
	})
})
