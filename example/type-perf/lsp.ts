// @ts-nocheck — perf harness, run under Bun (`bun run`), not in any typecheck gate.
/**
 * In-process TypeScript LanguageService latency benchmark under Bun.
 *
 * Instantiation count (see measure.ts) is a batch-`tsc` metric. This measures
 * type resolution on demand for a hover/completion by driving
 * the TypeScript LanguageService directly and times `getQuickInfoAtPosition`
 * (hover) and `getCompletionsAtPosition` at the positions you'd actually use,
 * changing a schema field before each request and checking the returned result.
 *
 *   bun run example/type-perf/lsp.ts [N=50] [package|source]
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
const entry = process.argv[3] ?? 'package'
if (!Number.isSafeInteger(N) || N < 1 || !['package', 'source'].includes(entry))
	throw new Error('usage: lsp.ts [positive route count] [package|source]')
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const tmp = join(here, '.lsp-tmp')
const fileName = join(tmp, 'app.ts')

// ── fixture: N schema'd routes + a guard, then a handler + a trailing `app.`
function fixture(n: number, field = 'age') {
	let s = `import { Elysia, t } from '${entry === 'source' ? `${root}/src` : 'elysia'}'\n\n`
	s += `const app = new Elysia()\n`
	s += `  .guard({ headers: t.Object({ authorization: t.String() }) })\n`
	for (let i = 0; i < n - 1; i++)
		s += `  .post('/r${i}/:id', { params: t.Object({ id: t.String() }), query: t.Object({ q${i}: t.String() }), body: t.Object({ a${i}: t.String(), b${i}: t.Number() }) }, ({ body, params }) => ({ ok: body.a${i}, id: params.id }))\n`
	// last route: handler body has the cursor markers
	s += `  .post('/last/:id', { params: t.Object({ id: t.String() }), body: t.Object({ name: t.String(), ${field}: t.Number() }) }, ({ body, params }) => {\n`
	s += `    const _b = body /*HOVER_BODY*/\n`
	s += `    body./*COMPLETE_BODY*/\n`
	s += `    return { ok: body.name }\n`
	s += `  })\n\n`
	s += `app./*COMPLETE_APP*/\n`
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
let field = 'age'
let snapshot = ts.ScriptSnapshot.fromString(source)
let previousSnapshot: ts.IScriptSnapshot | undefined
let changeRange: ts.TextChangeRange | undefined
let incrementalEdits = 0

const host: ts.LanguageServiceHost = {
	getScriptFileNames: () => [fileName],
	getScriptVersion: (f) => (f === fileName ? String(version) : '1'),
	getScriptSnapshot: (f) => {
		if (f === fileName) return snapshot
		const text = ts.sys.readFile(f)
		return text === undefined
			? undefined
			: ts.ScriptSnapshot.fromString(text)
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

const ms = (fn: () => unknown, check: (result: any) => void, k = 10) => {
	const samples: number[] = []
	for (let i = 0; i < k; i++) {
		const start = source.lastIndexOf(`${field}: t.Number()`)
		const length = field.length
		field = field === 'age' ? 'years' : 'age'
		source = fixture(N, field)
		previousSnapshot = snapshot
		changeRange = ts.createTextChangeRange(
			ts.createTextSpan(start, length),
			field.length
		)
		snapshot = ts.ScriptSnapshot.fromString(source)
		snapshot.getChangeRange = function (oldSnapshot) {
			if (this === snapshot && oldSnapshot === previousSnapshot) {
				incrementalEdits++
				return changeRange
			}
		}
		version++
		const editsBefore = incrementalEdits
		const t0 = performance.now()
		const result = fn()
		samples.push(performance.now() - t0)
		if (incrementalEdits === editsBefore)
			throw new Error(
				'LanguageService did not request the incremental edit range'
			)
		check(result)
	}
	const sorted = [...samples].sort((a, b) => a - b)
	return {
		median: (sorted[k / 2 - 1] + sorted[k / 2]) / 2,
		p95: sorted[Math.ceil(k * 0.95) - 1],
		samples
	}
}

const checkBody = (result: ts.QuickInfo | undefined) => {
	if (
		!ts
			.displayPartsToString(result?.displayParts)
			.includes(`${field}: number`)
	)
		throw new Error(`body hover did not observe schema field ${field}`)
}
const checkCompletions = (
	result: ts.CompletionInfo | undefined,
	names: string[]
) => {
	if (
		!names.every((name) =>
			result?.entries.some((entry) => entry.name === name)
		)
	)
		throw new Error(
			`completion missing expected entries: ${names.join(', ')}`
		)
}

try {
	// cold: first full program build + first hover (what you feel on file open)
	const cold0 = performance.now()
	const qi0 = ls.getQuickInfoAtPosition(fileName, at('HOVER_BODY', 1))
	const cold = performance.now() - cold0
	checkBody(qi0)

	const hoverBody = ms(
		() => ls.getQuickInfoAtPosition(fileName, at('HOVER_BODY', 1)),
		checkBody
	)
	const completeBody = ms(
		() =>
			ls.getCompletionsAtPosition(
				fileName,
				pos('COMPLETE_BODY'),
				undefined
			),
		(result) => checkCompletions(result, ['name', field])
	)
	const hoverApp = ms(
		() => ls.getQuickInfoAtPosition(fileName, at('HOVER_APP', 1)),
		(result) => {
			const display = ts.displayPartsToString(result?.displayParts)
			if (
				!display.startsWith('const app: ') ||
				/^const app: (any|unknown)$/.test(display)
			)
				throw new Error(
					`app hover did not resolve its type: ${display}`
				)
		}
	)
	const completeApp = ms(
		() =>
			ls.getCompletionsAtPosition(
				fileName,
				pos('COMPLETE_APP'),
				undefined
			),
		(result) => checkCompletions(result, ['get', 'post'])
	)

	const bodyType =
		qi0?.displayParts
			?.map((p) => p.text)
			.join('')
			.replace(/\s+/g, ' ')
			.slice(0, 80) ?? '?'

	console.log(
		`\n  LSP latency — ${N}-route app, ${entry} imports, incremental schema edit before each request\n`
	)
	console.log(`  cold first hover (program build):  ${cold.toFixed(0)} ms`)
	console.log(`  incremental edit ranges consumed: ${incrementalEdits}`)
	console.log(`  body type: ${bodyType}`)
	for (const [name, result] of Object.entries({
		hoverBody,
		completeBody,
		hoverApp,
		completeApp
	}))
		console.log(
			`  ${name}: median ${result.median.toFixed(1)} ms, p95 ${result.p95.toFixed(1)} ms; samples ${result.samples.map((v) => v.toFixed(1)).join(', ')}`
		)
} finally {
	ls.dispose()
	rmSync(tmp, { recursive: true, force: true })
}
