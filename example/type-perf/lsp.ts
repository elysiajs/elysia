// @ts-nocheck — perf harness, run under Bun (`bun run`), not in any typecheck gate.
/**
 * LSP latency benchmark — what the editor actually feels.
 *
 * Instantiation count (see measure.ts) is a batch-`tsc` metric; the editor pain
 * is `tsserver` resolving a type ON DEMAND for a hover/completion. This drives
 * the TypeScript LanguageService directly and times `getQuickInfoAtPosition`
 * (hover) and `getCompletionsAtPosition` at the positions you'd actually use,
 * simulating EDIT-THEN-HOVER (bump the file version to invalidate the cache, the
 * realistic case while typing).
 *
 *   bun run example/type-perf/lsp.ts [N=50]
 *
 * Positions measured (in an N-route app ending with a guard + a handler):
 *   - hover `body` inside the last handler   (route schema Static + Context)
 *   - completions after `body.`              (property resolution)
 *   - hover the final `app` const            (the accumulated Elysia<…,Routes,…>)
 *   - completions after `app.`               (verb overloads vs accumulated generics)
 */
import ts from 'typescript'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const N = Number(process.argv[2] ?? 50)
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const tmp = join(here, '.lsp-tmp')
const fileName = join(tmp, 'app.ts')

// ── fixture: N schema'd routes + a guard, then a handler + a trailing `app.`
function fixture(n: number) {
	let s = `import { Elysia, t } from '${root}/src'\n\n`
	s += `const app = new Elysia()\n`
	s += `  .guard({ headers: t.Object({ authorization: t.String() }) })\n`
	for (let i = 0; i < n - 1; i++)
		s += `  .post('/r${i}/:id', { params: t.Object({ id: t.String() }), query: t.Object({ q${i}: t.String() }), body: t.Object({ a${i}: t.String(), b${i}: t.Number() }) }, ({ body, params }) => ({ ok: body.a${i}, id: params.id }))\n`
	// last route: handler body has the cursor markers
	s += `  .post('/last/:id', { params: t.Object({ id: t.String() }), body: t.Object({ name: t.String(), age: t.Number() }) }, ({ body, params }) => {\n`
	s += `    const _b = body /*HOVER_BODY*/\n`
	s += `    body./*COMPLETE_BODY*/\n`
	s += `    return { ok: body.name }\n`
	s += `  })\n\n`
	s += `app/*COMPLETE_APP*/\n`
	s += `const _app = app /*HOVER_APP*/\n`
	return s
}

const compilerOptions: ts.CompilerOptions = {
	target: ts.ScriptTarget.ES2020,
	module: ts.ModuleKind.ES2022,
	moduleResolution: ts.ModuleResolutionKind.Bundler,
	strict: true,
	skipLibCheck: true,
	esModuleInterop: true,
	types: ['@types/bun'],
	lib: ['lib.esnext.d.ts'],
	noEmit: true
}

rmSync(tmp, { recursive: true, force: true })
mkdirSync(tmp, { recursive: true })
let source = fixture(N)
writeFileSync(fileName, source)
let version = 1

const host: ts.LanguageServiceHost = {
	getScriptFileNames: () => [fileName],
	getScriptVersion: (f) => (f === fileName ? String(version) : '1'),
	getScriptSnapshot: (f) => {
		const text = f === fileName ? source : (ts.sys.readFile(f) ?? undefined)
		return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text)
	},
	getCurrentDirectory: () => root,
	getCompilationSettings: () => compilerOptions,
	getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
	fileExists: ts.sys.fileExists,
	readFile: ts.sys.readFile,
	readDirectory: ts.sys.readDirectory,
	directoryExists: ts.sys.directoryExists,
	getDirectories: ts.sys.getDirectories
}

const ls = ts.createLanguageService(host, ts.createDocumentRegistry())
const pos = (marker: string) => source.indexOf('/*' + marker + '*/')
const at = (marker: string, before: number) => pos(marker) - before

const ms = (fn: () => void, k = 5) => {
	let min = Infinity
	for (let i = 0; i < k; i++) {
		// simulate an edit: bump version so the LS re-resolves (invalidate cache)
		version++
		const t0 = performance.now()
		fn()
		min = Math.min(min, performance.now() - t0)
	}
	return min
}

try {
	// cold: first full program build + first hover (what you feel on file open)
	const cold0 = performance.now()
	const qi0 = ls.getQuickInfoAtPosition(fileName, at('HOVER_BODY', 1))
	const cold = performance.now() - cold0

	const hoverBody = ms(() => ls.getQuickInfoAtPosition(fileName, at('HOVER_BODY', 1)))
	const completeBody = ms(() =>
		ls.getCompletionsAtPosition(fileName, pos('COMPLETE_BODY'), undefined)
	)
	const hoverApp = ms(() => ls.getQuickInfoAtPosition(fileName, at('HOVER_APP', 1)))
	const completeApp = ms(() =>
		ls.getCompletionsAtPosition(fileName, pos('COMPLETE_APP'), undefined)
	)

	const bodyType =
		qi0?.displayParts?.map((p) => p.text).join('').replace(/\s+/g, ' ').slice(0, 80) ?? '?'

	console.log(`\n  LSP latency — ${N}-route app (guard + schema'd routes), edit-then-hover min of 5\n`)
	console.log(`  cold first hover (program build):  ${cold.toFixed(0)} ms`)
	console.log(`  hover  body  (in handler):         ${hoverBody.toFixed(1)} ms   → ${bodyType}`)
	console.log(`  complete  body.  :                 ${completeBody.toFixed(1)} ms`)
	console.log(`  hover  app  (accumulated type):    ${hoverApp.toFixed(1)} ms`)
	console.log(`  complete  app.   (verb overloads): ${completeApp.toFixed(1)} ms\n`)
} finally {
	rmSync(tmp, { recursive: true, force: true })
}
