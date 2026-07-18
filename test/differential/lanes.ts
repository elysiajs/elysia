// A lane runs one app configuration through either app.handle or a real socket.
// Every lane owns a fresh app and must release its resources in dispose().

import '../../src/compile/aot-capture' // installs captureImpl (side effect)
import { Elysia, type AnyElysia } from '../../src'
import { resumeEmit } from '../../src/experimental/resume'
import { validationPlan } from '../../src/experimental/validation-plan'
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
export const resumeHandle = handleLane('resume-handle', {
	experimental: { resumeEmit }
})
export const flatFormDataFastPathHandle = handleLane(
	'flat-formdata-fast-path-handle',
	{
		experimental: { flatFormDataFastPath: true }
	}
)
export const validationPlanHandle = handleLane('validation-plan-handle', {
	experimental: { validationPlan }
})
export const inferenceCandidateHandle = handleLane(
	'inference-candidate-handle',
	{
		experimental: { inference: 'candidate' }
	}
)

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
					await assertPortClosed(id, port)
				}
			}
		}
	}) satisfies LaneFactory

// Retry until the operating system stops accepting connections on the port.
async function assertPortClosed(
	id: string,
	port: number,
	timeoutMs = 200
): Promise<void> {
	const deadline = Date.now() + timeoutMs
	for (;;) {
		let accepted = false
		try {
			await fetch(`http://localhost:${port}/`, {
				signal: AbortSignal.timeout(50)
			})
			accepted = true
		} catch {}
		if (!accepted) return
		if (Date.now() >= deadline)
			throw new Error(
				`[${id}] port ${port} still accepts connections after stop(true) — leaked`
			)
		await new Promise((r) => setTimeout(r, 10))
	}
}

export const jitListen = listenLane('jit-listen', {})
export const precompileListen = listenLane('precompile-listen', {
	precompile: true
})
export const resumeListen = listenLane('resume-listen', {
	experimental: { resumeEmit }
})
export const inferenceCandidateListen = listenLane(
	'inference-candidate-listen',
	{
		experimental: { inference: 'candidate' }
	}
)
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
	new Function('Compiled', 'Reconstruct', 'buildCoercedFromPlan', body)(
		Compiled,
		Reconstruct,
		buildCoercedFromPlan
	)
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
		const { source: manifestSource } = await captureArtifacts(source, {
			register: true
		})

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
		id: 'jit-vs-validation-plan@handle',
		oracle: jitHandle,
		candidate: validationPlanHandle
	},
	{
		id: 'inference-oracle-vs-candidate@handle',
		oracle: jitHandle,
		candidate: inferenceCandidateHandle,
		requiresTag: 'inference'
	},
	{
		id: 'inference-oracle-vs-candidate@listen',
		oracle: jitListen,
		candidate: inferenceCandidateListen,
		requiresTag: 'inference'
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
	},
	{
		id: 'jit-vs-resume@handle',
		oracle: jitHandle,
		candidate: resumeHandle
	},
	{
		id: 'formdata-default-vs-flat-fast-path@handle',
		oracle: jitHandle,
		candidate: flatFormDataFastPathHandle,
		requiresTag: 'form'
	},
	{
		id: 'jit-vs-resume@listen',
		oracle: jitListen,
		candidate: resumeListen,
		requiresTag: 'safe-for-socket'
	}
]
