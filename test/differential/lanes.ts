// A lane runs one app configuration through either app.handle or a real socket.
// Every lane owns a fresh app and must release its resources in dispose().

import '../../src/compile/aot-capture' // installs captureImpl (side effect)
import { existsSync, readFileSync, readdirSync, readlinkSync } from 'node:fs'
import { Elysia, type AnyElysia } from '../../src'
import { Compiled, type CompiledSnapshot } from '../../src/compile/aot'
import {
	snapshotCompiled,
	restoreCompiled
} from '../../src/compile/aot-capture'
import { Validator } from '../../src/validator'
import { captureArtifacts } from '../../src/plugin/aot/source'
import { Reconstruct } from '../../src/compile/aot-reconstruct'
import { installReconstructImpl } from '../../src/compile/aot-emit'
import { buildCoercedFromPlan } from '../../src/type/coerce-plan'
import { routeShape } from '../../src/compile/handler/route-shape'

export type Define = (app: AnyElysia) => AnyElysia

export type Observe = () => unknown

export interface Lane {
	handle(req: Request): Promise<Response>
	observe?(): unknown
	dispose(): Promise<void>
}

export interface LaneFactory {
	id: string
	transport: 'handle' | 'listen'
	make(define: Define, observe?: Observe): Promise<Lane>
}

// In-process lanes

const handleLane = (
	id: string,
	config: ConstructorParameters<typeof Elysia>[0]
) =>
	({
		id,
		transport: 'handle',
		async make(define, observe?) {
			const app = define(new Elysia(config))
			// Compare both configurations after compilation.
			await (app as any).modules
			;(app as any).compile()
			return {
				handle: (req) => app.handle(req),
				observe,
				dispose: async () => {}
			}
		}
	}) satisfies LaneFactory

export const jitHandle = handleLane('jit-handle', {})
export const precompileHandle = handleLane('precompile-handle', {
	precompile: true
})

// No compile() up front: each route compiles on its first request.
export const lazyHandle = {
	id: 'lazy-handle',
	transport: 'handle',
	async make(define) {
		const app = define(new Elysia())

		return { handle: (req) => app.handle(req), dispose: async () => {} }
	}
} satisfies LaneFactory

// Real-socket lanes

const listenLane = (
	id: string,
	config: ConstructorParameters<typeof Elysia>[0]
) =>
	({
		id,
		transport: 'listen',
		async make(define, observe?) {
			const app = define(new Elysia(config))
			await (app as any).modules
			app.listen(0)
			const server = (app as any).server
			if (!server) throw new Error(`[${id}] listen(0) produced no server`)
			const port: number = server.port
			const hostname: string = server.hostname
			const origin = `http://localhost:${port}`

			return {
				async handle(req) {
					const target = new URL(req.url)
					const rewritten = new URL(
						target.pathname + target.search,
						origin
					)
					const init: RequestInit = {
						method: req.method,
						headers: req.headers,
						body:
							req.method === 'GET' || req.method === 'HEAD'
								? undefined
								: await req.arrayBuffer(),
						redirect: 'manual'
					}
					return fetch(rewritten, init)
				},
				observe,
				async dispose() {
					await app.stop(true)
					await assertPortClosed(id, hostname, port)
				}
			}
		}
	}) satisfies LaneFactory

// Retry until the operating system lets us bind the port again: a leaked
// listener keeps it bound; a neighbour that briefly reused the port frees it.
// `app.listen(0)` never passes a hostname to Bun.serve, so the real bind is
// the IPv4 + IPv6 wildcard ("all interfaces"), even though `server.hostname`
// only ever reports the cosmetic default label 'localhost'. Probing a
// loopback address instead of the wildcard never collides with that listener,
// so re-bind the same wildcard pair the server actually used in that case.
const wildcardAddresses = ['0.0.0.0', '::']

// A failed re-bind alone does not prove a leak. macOS hands `listen(0)` a port
// that another user's socket holds on a specific address (Tailscale, OrbStack's
// kernel_task), then refuses an explicit bind of it for as long as that socket
// lives. Ask the socket table whether the listener is in this process: /proc
// on Linux, lsof elsewhere. `undefined` when neither answers: the caller keeps
// treating the port as leaked.
const ownsListener = (port: number): boolean | undefined => {
	try {
		if (process.platform === 'linux') {
			// row: sl local_address rem_address st ... inode, LISTEN is st 0A
			const local = `:${port.toString(16).toUpperCase().padStart(4, '0')}`
			const sockets = new Set<string>()
			for (const table of ['/proc/net/tcp', '/proc/net/tcp6']) {
				if (!existsSync(table)) continue
				for (const row of readFileSync(table, 'utf8').split('\n')) {
					const cell = row.trim().split(/\s+/)
					if (cell[3] === '0A' && cell[1].endsWith(local))
						sockets.add(`socket:[${cell[9]}]`)
				}
			}

			return readdirSync('/proc/self/fd').some((fd) => {
				try {
					return sockets.has(readlinkSync(`/proc/self/fd/${fd}`))
				} catch {
					return false
				}
			})
		}

		const { exitCode, stdout, stderr } = Bun.spawnSync([
			'lsof',
			'-nPw',
			'-a',
			'-p',
			String(process.pid),
			`-iTCP:${port}`,
			'-sTCP:LISTEN',
			'-t'
		])
		if (exitCode === 0) return true
		if (exitCode === 1 && !stdout.length && !stderr.length) return false
	} catch {}
}

export async function assertPortClosed(
	id: string,
	hostname: string,
	port: number,
	timeoutMs = 2000
): Promise<void> {
	const candidates = hostname === 'localhost' ? wildcardAddresses : [hostname]
	const deadline = Date.now() + timeoutMs
	for (;;) {
		let bound = false
		for (const candidate of candidates) {
			try {
				const probe = Bun.listen({
					hostname: candidate,
					port,
					socket: { data() {} }
				})
				probe.stop(true)
			} catch (error) {
				if ((error as any)?.code !== 'EADDRINUSE') {
					if (candidates.length === 1) throw error
					continue
				}
				bound = true
			}
		}
		if (!bound) return
		const owned = ownsListener(port)
		if (owned === false) return
		if (Date.now() >= deadline)
			throw new Error(
				`[${id}] port ${port} is still bound after stop(true) — leaked` +
					(owned ? '' : ' (holder unverified)')
			)
		await new Promise((r) => setTimeout(r, 10))
	}
}

export const jitListen = listenLane('jit-listen', {})
export const precompileListen = listenLane('precompile-listen', {
	precompile: true
})
export const nativeStaticOn = listenLane('native-static-on', {
	nativeStaticResponse: true
})
export const nativeStaticOff = listenLane('native-static-off', {
	nativeStaticResponse: false
})

// AOT capture and reconstruction

// Evaluate the manifest against the same Compiled registry used by the app.
const evalManifest = (source: string): void => {
	const body = source
		.replace(/^import .*$/gm, '')
		.replace(/^export const /gm, 'const ')
		.replace(/^export default .*$/gm, '')
	// eslint-disable-next-line no-new-func, sonarjs/code-eval
	new Function(
		'Compiled',
		'Reconstruct',
		'buildCoercedFromPlan',
		'routeShape',
		body
	)(Compiled, Reconstruct, buildCoercedFromPlan, routeShape)
}

// Capture is process-global and non-reentrant. Restore the compiled registry
// verbatim and clear validator memo caches before the next sequential lane.
export const aotReconstructHandle = {
	id: 'aot-reconstruct-handle',
	transport: 'handle',
	async make(define, observe?) {
		const snapshot: CompiledSnapshot = snapshotCompiled()

		Compiled.clear()
		Validator.clear()

		const source = define(new Elysia())
		const { source: manifestSource } = await captureArtifacts(source)

		installReconstructImpl()
		evalManifest(manifestSource)

		const app = define(new Elysia())
		;(app as any).compile()

		return {
			handle: (req) => app.handle(req),
			observe,
			async dispose() {
				restoreCompiled(snapshot)
				Validator.clear()
			}
		}
	}
} satisfies LaneFactory

export interface LanePair {
	id: string
	oracle: LaneFactory
	candidate: LaneFactory
	requiresTag?: string
}

export const lanePairs: LanePair[] = [
	{
		id: 'jit-vs-precompile@handle',
		oracle: jitHandle,
		candidate: precompileHandle
	},
	{
		id: 'jit-vs-precompile@listen',
		oracle: jitListen,
		candidate: precompileListen,
		requiresTag: 'safe-for-socket'
	},
	{
		id: 'native-static-off-vs-on@listen',
		oracle: nativeStaticOff,
		candidate: nativeStaticOn,
		requiresTag: 'safe-for-socket'
	},
	{
		id: 'jit-vs-aot-reconstruct@handle',
		oracle: jitHandle,
		candidate: aotReconstructHandle
	}
]
