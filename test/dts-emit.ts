import {
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Emit a consumer's declaration file against the built `dist` and check that
// Elysia's types print in it. Run `bun run build` first.
//
// - An unexported interface reaching an exported app's type can't be named,
//   so the consumer's `tsc --declaration` fails (TS4023)
// - An exported alias inside a route's `response` prints as
//   `import("elysia/...")`, which d.ts readers such as `@elysiajs/openapi`
//   `fromTypes` can't follow, so the route is dropped
//
// A route's response map only prints once another route follows it, and the
// last route's hook object prints as a type argument, so cases cover both

const header = `import { Elysia, HTTPError, status, t } from 'elysia'
import { websocket } from 'elysia/plugin/websocket'
class OutOfCredit extends HTTPError.id('OUT_OF_CREDIT', 402) {}
class Detailed extends HTTPError.id('DETAILED', 409) {
	override readonly detail = 'detailed'
}
class Lib extends Error {}
const plugin = new Elysia({ name: 'plugin' }).get('/p', () => 'p' as const)
const socket = new Elysia().use(websocket())
const sockets = new Elysia().use(websocket()).ws('/ws', { message() {} })
void status, t, OutOfCredit, Detailed, Lib, plugin, socket, sockets
`

const next = `.get('/next', () => 'next' as const)`

const cases: Record<string, string> = {
	message: `new Elysia().get('/', () => new OutOfCredit())${next}`,
	detail: `new Elysia().get('/', () => new Detailed())${next}`,
	foreign: `new Elysia().get('/', () => new Lib())${next}`,
	status: `new Elysia().get('/', () => status(418, 'teapot'))${next}`,
	validation: `new Elysia().post('/', { body: t.Object({ a: t.String() }) }, ({ body }) => body)${next}`,
	handled: `new Elysia().onError(Lib, () => status(418, 'handled' as const)).get('/', () => new Lib())${next}`,
	catchAll: `new Elysia().onError(() => status(503, 'down' as const)).get('/', () => new Lib())${next}`,
	catchAllGlobal: `new Elysia().onError({ as: 'global' }, () => status(503, 'down' as const)).get('/', () => 'ok' as const)`,
	routeError: `new Elysia().get('/', { error: () => status(500, 'error' as const) }, () => new Lib())${next}`,
	catchAllPlain: `new Elysia().onError(() => 'local' as const).onError('global', () => 'global' as const).get('/', () => new Lib())${next}`,
	catchAllError: `new Elysia().onError(() => new Lib()).get('/', () => new OutOfCredit())${next}`,
	catchAllValidation: `new Elysia().onError(() => 'invalid' as const).post('/', { body: t.Object({ a: t.String() }) }, ({ body }) => body)${next}`,
	guardError: `new Elysia().guard({ error: () => 'guard' as const }).get('/', () => new OutOfCredit())${next}`,
	macroError: `new Elysia().macro({ rescue: { error: () => 'macro' as const } }).get('/', { rescue: true }, () => new OutOfCredit())${next}`,
	parentValidation: `new Elysia().onError(Error, () => status(418, 'parent' as const)).use(new Elysia().get('/v', { query: t.Object({ n: t.Numeric() }) }, () => 'ok' as const))${next}`,
	parentPasses: `new Elysia().onError(({ query }) => (query.pass ? undefined : 'parent' as const)).use(new Elysia().onError(() => 'child' as const).get('/p', () => new Lib()))${next}`,
	beforeHandle: `new Elysia().get('/', { beforeHandle: () => new OutOfCredit() }, () => 'ok' as const)${next}`,
	parentHook: `new Elysia().onBeforeHandle(() => new Error('denied')).use(plugin)${next}`,
	lastEmptyHook: `new Elysia().get('/', {}, () => 'ok' as const)`,
	lastTagsHook: `new Elysia().get('/', { tags: ['a'] }, () => 'ok' as const)`,
	lastDetailHook: `new Elysia().get('/', { detail: { hide: true } }, () => 'ok' as const)`,
	lastParseHook: `new Elysia().post('/', { parse: 'json' }, ({ body }) => body)`,
	wsHook: `socket.onBeforeHandle(() => new OutOfCredit()).ws('/ws', { message() {} })${next}`,
	wsHandled: `socket.onError(OutOfCredit, () => status(418, 'handled' as const)).onBeforeHandle(() => new Lib()).ws('/ws', { message() {} })${next}`,
	wsRouteHook: `socket.ws('/ws', { beforeHandle: () => new OutOfCredit(), message() {} })${next}`,
	wsLastRouteHook: `socket.ws('/ws', { beforeHandle: () => new OutOfCredit(), message() {} })`,
	wsParentHook: `socket.onBeforeHandle(() => new OutOfCredit()).use(sockets)${next}`,
	asyncPlugin: `new Elysia().use(async () => plugin)`,
	useMethod: `new Elysia().use`,
	getMethod: `new Elysia().get`
}

const root = fileURLToPath(new URL('..', import.meta.url))
// real path, or tsc prints every error path relative through the symlink
const dir = realpathSync(mkdtempSync(join(tmpdir(), 'elysia-dts-emit-')))

for (const [name, app] of Object.entries(cases))
	writeFileSync(
		join(dir, `${name}.ts`),
		`${header}export const app = ${app}\n`
	)

writeFileSync(
	join(dir, 'tsconfig.json'),
	JSON.stringify({
		compilerOptions: {
			strict: true,
			skipLibCheck: true,
			target: 'ES2021',
			lib: ['ESNext'],
			module: 'ESNext',
			moduleResolution: 'bundler',
			types: ['bun'],
			typeRoots: [join(root, 'node_modules/@types')],
			paths: {
				elysia: [join(root, 'dist/index.d.ts')],
				'elysia/*': [join(root, 'dist/*')]
			},
			declaration: true,
			emitDeclarationOnly: true,
			rootDir: '.',
			outDir: 'out'
		},
		include: ['*.ts']
	})
)

const failures: string[] = []

try {
	const proc = Bun.spawnSync({
		cmd: [join(root, 'node_modules/.bin/tsc'), '-p', dir],
		cwd: dir,
		stdout: 'pipe',
		stderr: 'pipe'
	})

	for (const line of proc.stdout.toString().split('\n'))
		if (line.includes('error TS')) failures.push(line.trim())

	if (proc.exitCode !== 0 && !failures.length)
		failures.push(`tsc exited with code ${proc.exitCode}`)

	for (const name of Object.keys(cases)) {
		let source: string

		try {
			source = readFileSync(join(dir, 'out', `${name}.d.ts`), 'utf8')
		} catch {
			failures.push(`${name}: no declaration emitted`)
			continue
		}

		const named = importsInResponse(source)
		if (named.length)
			failures.push(`${name}: response prints ${named.join(', ')}`)

		console.log(`${name}: ${source.length} bytes`)
	}
} finally {
	rmSync(dir, { recursive: true, force: true })
}

if (failures.length)
	throw new Error(
		`consumer declaration emit:\n${failures.map((f) => `  ${f}`).join('\n')}`
	)

// `import("elysia...")` references inside every `response: { ... }` block
function importsInResponse(source: string) {
	const found = new Set<string>()

	for (const match of source.matchAll(/response: \{/g)) {
		const start = match.index + match[0].length - 1
		let depth = 0
		let end = start

		for (; end < source.length; end++)
			if (source[end] === '{') depth++
			else if (source[end] === '}' && --depth === 0) break

		for (const ref of source
			.slice(start, end)
			.matchAll(/import\("elysia[^"]*"\)\.[\w$~]+/g))
			found.add(ref[0])
	}

	return [...found]
}
