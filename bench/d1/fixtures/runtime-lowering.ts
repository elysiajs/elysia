import { resolve } from 'node:path'

import { gc, memorySnapshot } from '../../../example/stress/utils'
import {
	injectExecutable,
	injectN2bRetained,
	injectN2bRuntime
} from '../inject'
import { integerArgument } from './utils'

const repoRoot =
	process.env.D1_ELYSIA_ROOT ?? resolve(import.meta.dir, '../../..')
const cancellationLane = process.env.D1_N2B_CANCELLATION ?? 'default'
const candidate = process.env.D1_N2B_CANDIDATE === '1'

if (cancellationLane !== 'default' && cancellationLane !== 'compat')
	throw new Error(`invalid D1 N+2b cancellation lane: ${cancellationLane}`)

const deferred = () => {
	let resolve!: () => void
	const promise = new Promise<void>((resolve_) => (resolve = resolve_))
	return { promise, resolve }
}

const awaitCompletion = async <T>(promise: Promise<T>, label: string) => {
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() =>
						reject(
							new Error(`${label} did not complete within 1s`)
						),
					1_000
				)
			})
		])
	} finally {
		if (timer) clearTimeout(timer)
	}
}

const awaitCount = async (
	read: () => number,
	expected: number,
	label: string
) => {
	for (let attempt = 0; attempt < 32; attempt++) {
		if (read() === expected) return
		await Promise.resolve()
	}

	throw new Error(`${label} did not reach suspension`)
}

async function consume(response: Response, status = 200) {
	if (response.status !== status)
		throw new Error(
			`runtime-lowering expected ${status}, got ${response.status}`
		)
	return response.text()
}

async function measure(
	warmup: number,
	requests: number,
	batch: number,
	run: () => Promise<Response>,
	status = 200
) {
	for (let i = 0; i < warmup * batch; i++) await consume(await run(), status)
	const samples: number[] = []
	for (let sample = 0; sample < requests; sample++) {
		const started = Bun.nanoseconds()
		for (let i = 0; i < batch; i++) await consume(await run(), status)
		samples.push((Bun.nanoseconds() - started) / batch)
	}
	return samples
}

const deltaPerRequest = (after: number, before: number, requests: number) =>
	(after - before) / requests

async function main() {
	const warmup = integerArgument('warmup', 50)
	const requests = integerArgument('requests', 200)
	const routes = integerArgument('routes', 1_000)
	const batch = 25
	const allocationRequests = Math.min(routes, 256)
	const blockedRequests = Math.min(routes, 128)
	const [{ Elysia, t }, { createContext }, jsc] =
		await Promise.all([
			import(repoRoot + '/src/index.ts'),
			import(repoRoot + '/src/context.ts'),
			import('bun:jsc')
		])
	const config =
		cancellationLane === 'compat'
			? { experimental: { cancellation: 'compat' as const } }
			: {}

	const contextLight = new Elysia(config).get('/context', () => {
		injectN2bRuntime()
		return 'ok'
	})
	const contextLightSamples = await measure(warmup, requests, batch, () =>
		contextLight.handle(new Request('http://localhost/context'))
	)

	const contextAllocationApp = new Elysia({
		...config,
		introspect: true
	}).get('/allocation', () => 'ok')
	await consume(
		await contextAllocationApp.handle(
			new Request('http://localhost/allocation')
		)
	)
	const allocationRoute = (contextAllocationApp as any)['~generation'].plan
		.httpRoutes[0]
	const allocationContextMode = allocationRoute?.program.content?.contextMode
	if (candidate && allocationContextMode !== 'compact')
		throw new Error(
			'Context allocation fixture did not compile a compact route'
		)

	const Context = createContext(contextAllocationApp as any)
	const allocationRequest = new Request('http://localhost/allocation')
	const retainedContexts = new Array(allocationRequests)
	const contextBefore = { heapSize: 0, objectCount: 0 }
	const contextAfter = { heapSize: 0, objectCount: 0 }
	let contextSnapshot: ReturnType<typeof jsc.heapStats> | undefined
	gc()
	contextSnapshot = jsc.heapStats()
	contextBefore.heapSize = contextSnapshot.heapSize
	contextBefore.objectCount = contextSnapshot.objectCount
	contextSnapshot = undefined
	for (let i = 0; i < allocationRequests; i++)
		retainedContexts[i] = new Context(allocationRequest)
	gc()
	contextSnapshot = jsc.heapStats()
	contextAfter.heapSize = contextSnapshot.heapSize
	contextAfter.objectCount = contextSnapshot.objectCount
	const contextBytes = deltaPerRequest(
		contextAfter.heapSize,
		contextBefore.heapSize,
		allocationRequests
	)
	const contextObjects = deltaPerRequest(
		contextAfter.objectCount,
		contextBefore.objectCount,
		allocationRequests
	)
	retainedContexts.length = 0
	gc()

	const identity: unknown[] = []
	const identityAfterResponse = deferred()
	const identityApp = new Elysia(config).get(
		'/identity',
		{
			transform(context: any) {
				identity.push(context)
			},
			beforeHandle(context: any) {
				identity.push(context)
			},
			afterHandle(context: any) {
				identity.push(context)
			},
			afterResponse(context: any) {
				identity.push(context)
				identityAfterResponse.resolve()
			}
		} as any,
		(context: any) => {
			identity.push(context)
			return 'identity'
		}
	)
	await consume(
		await identityApp.handle(new Request('http://localhost/identity'))
	)
	await awaitCompletion(
		identityAfterResponse.promise,
		'identity afterResponse hook'
	)
	const identityMismatches = identity.filter(
		(context) => context !== identity[0]
	).length
	if (identity.length !== 5 || identityMismatches)
		throw new Error('lifecycle callbacks did not preserve Context identity')

	const headersApp = new Elysia(config)
		.get('/one', ({ headers }: any) => headers['x-one'])
		.get('/all', ({ headers }: any) => String(Object.keys(headers).length))
	const oneHeaderRequest = new Request('http://localhost/one', {
		headers: { 'x-one': 'one', 'x-two': 'two', 'x-three': 'three' }
	})
	const allHeadersRequest = new Request('http://localhost/all', {
		headers: { 'x-one': 'one', 'x-two': 'two', 'x-three': 'three' }
	})
	const oneHeaderSamples = await measure(warmup, requests, batch, () =>
		headersApp.handle(oneHeaderRequest)
	)
	const fullHeadersSamples = await measure(warmup, requests, batch, () =>
		headersApp.handle(allHeadersRequest)
	)
	if (
		(await consume(await headersApp.handle(oneHeaderRequest))) !== 'one' ||
		(await consume(await headersApp.handle(allHeadersRequest))) !== '3'
	)
		throw new Error('header fixtures returned an unexpected value')

	const syncLifecycle = new Elysia(config).get(
		'/sync',
		{
			transform() {},
			beforeHandle() {},
			afterHandle() {}
		} as any,
		() => 'sync'
	)
	const asyncLifecycle = new Elysia(config).get(
		'/async',
		{
			beforeHandle: async () => {
				await Promise.resolve()
			}
		} as any,
		() => 'async'
	)
	const lifecycleSyncSamples = await measure(warmup, requests, batch, () =>
		syncLifecycle.handle(new Request('http://localhost/sync'))
	)
	const lifecycleAsyncSamples = await measure(warmup, requests, batch, () =>
		asyncLifecycle.handle(new Request('http://localhost/async'))
	)

	const plain404 = new Elysia(config)
	let hooked404Count = 0
	const hooked404 = new Elysia(config).error(({ error }: any) => {
		if (error?.status !== 404) return
		hooked404Count++
		return `${error.name}:${error.status}`
	})
	const plain404Samples = await measure(
		warmup,
		requests,
		batch,
		() => plain404.handle(new Request('http://localhost/missing')),
		404
	)
	const hooked404Samples = await measure(
		warmup,
		requests,
		batch,
		() => hooked404.handle(new Request('http://localhost/missing')),
		404
	)
	if (hooked404Count !== (warmup + requests) * batch)
		throw new Error('hooked 404 did not materialize exactly once')

	const errorApp = new Elysia(config).post(
		'/invalid',
		{ body: t.Object({ id: t.Number() }) },
		() => 'unreachable'
	)
	const invalid = () =>
		new Request('http://localhost/invalid', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: '{"id":"bad"}'
		})
	const previousNodeEnv = process.env.NODE_ENV
	process.env.NODE_ENV = 'development'
	const dev422Samples = await measure(
		warmup,
		requests,
		batch,
		() => errorApp.handle(invalid()),
		422
	)
	const devBody = await consume(await errorApp.handle(invalid()), 422)
	process.env.NODE_ENV = 'production'
	const prod422Samples = await measure(
		warmup,
		requests,
		batch,
		() => errorApp.handle(invalid()),
		422
	)
	const prodBody = await consume(await errorApp.handle(invalid()), 422)
	if (previousNodeEnv === undefined) delete process.env.NODE_ENV
	else process.env.NODE_ENV = previousNodeEnv
	if (!devBody.includes('id') || prodBody.includes('bad'))
		throw new Error('development/production 422 masking parity failed')

	let traceCount = 0
	const traced = new Elysia(config)
		.trace(({ onHandle }: any) => {
			onHandle(() => {
				traceCount++
			})
		})
		.get('/trace', () => 'trace')
	const traceSamples = await measure(warmup, requests, batch, () =>
		traced.handle(new Request('http://localhost/trace'))
	)
	if (traceCount !== (warmup + requests) * batch)
		throw new Error('trace fixture did not observe every handle span')

	const afterResponseExpected = (warmup + requests) * batch
	const syncAfterResponseComplete = deferred()
	let syncAfterResponseCount = 0
	const syncAfterResponse = new Elysia(config).get(
		'/after',
		{
			afterResponse: () => {
				if (++syncAfterResponseCount === afterResponseExpected)
					syncAfterResponseComplete.resolve()
			}
		} as any,
		() => 'after'
	)
	const asyncAfterResponseComplete = deferred()
	let asyncAfterResponseCount = 0
	const asyncAfterResponse = new Elysia(config).get(
		'/after',
		{
			afterResponse: async () => {
				await Promise.resolve()
				if (++asyncAfterResponseCount === afterResponseExpected)
					asyncAfterResponseComplete.resolve()
			}
		} as any,
		() => 'after'
	)
	const syncAfterResponseSamples = await measure(
		warmup,
		requests,
		batch,
		() => syncAfterResponse.handle(new Request('http://localhost/after'))
	)
	const asyncAfterResponseSamples = await measure(
		warmup,
		requests,
		batch,
		() => asyncAfterResponse.handle(new Request('http://localhost/after'))
	)
	await awaitCompletion(
		Promise.all([
			syncAfterResponseComplete.promise,
			asyncAfterResponseComplete.promise
		]),
		'afterResponse hooks'
	)
	if (
		syncAfterResponseCount !== afterResponseExpected ||
		asyncAfterResponseCount !== afterResponseExpected
	)
		throw new Error('afterResponse fixture did not complete exactly once')

	let gate = deferred()
	let blockedStarted = 0
	let blockedFullGcSnapshots = 0
	const blockedSnapshot = () => {
		blockedFullGcSnapshots++
		return {
			...memorySnapshot(),
			rss: process.memoryUsage().rss
		}
	}
	const blocked = new Elysia(config).get('/blocked', async () => {
		const index = blockedStarted++
		injectN2bRetained(index)
		await gate.promise
		return 'released'
	})
	const blockedWarmup = blocked.handle(
		new Request('http://localhost/blocked?warmup=1')
	)
	await awaitCount(() => blockedStarted, 1, 'blocked warmup fixture')
	const blockedWarmups = blockedStarted
	gate.resolve()
	await consume(await blockedWarmup)
	blockedStarted = 0
	gate = deferred()
	const blockedBase = blockedSnapshot()
	const releaseBatch = Array.from({ length: blockedRequests }, (_, index) =>
		blocked.handle(new Request(`http://localhost/blocked?release=${index}`))
	)
	await awaitCount(
		() => blockedStarted,
		blockedRequests,
		'blocked completion fixture'
	)
	const blockedBeforeRelease = blockedSnapshot()
	gate.resolve()
	for (const response of await Promise.all(releaseBatch))
		await consume(response)
	releaseBatch.length = 0
	const blockedAfterRelease = blockedSnapshot()

	gate = deferred()
	const abortOffset = blockedStarted
	const controllers = Array.from(
		{ length: blockedRequests },
		() => new AbortController()
	)
	const abortBatch = controllers.map((controller, index) =>
		blocked.handle(
			new Request(`http://localhost/blocked?abort=${index}`, {
				signal: controller.signal
			})
		)
	)
	await awaitCount(
		() => blockedStarted,
		abortOffset + blockedRequests,
		'abort fixture'
	)
	for (const controller of controllers) controller.abort()
	const blockedAfterAbort = blockedSnapshot()
	gate.resolve()
	await Promise.allSettled(abortBatch)
	abortBatch.length = 0
	controllers.length = 0
	const blockedAfterAbortRelease = blockedSnapshot()
	const blockedDeltas = (
		snapshot: ReturnType<typeof blockedSnapshot>,
		base = blockedBase
	) => ({
		current: (snapshot.current - base.current) / blockedRequests,
		heapSize: (snapshot.heapSize - base.heapSize) / blockedRequests,
		extraMemorySize:
			(snapshot.extraMemorySize - base.extraMemorySize) / blockedRequests,
		rss: (snapshot.rss - base.rss) / blockedRequests
	})
	const beforeReleaseDeltas = blockedDeltas(blockedBeforeRelease)
	const afterReleaseDeltas = blockedDeltas(blockedAfterRelease)
	const afterAbortDeltas = blockedDeltas(
		blockedAfterAbort,
		blockedAfterRelease
	)
	const afterAbortReleaseDeltas = blockedDeltas(
		blockedAfterAbortRelease,
		blockedAfterRelease
	)

	gc()
	const countBefore = jsc.heapStats().objectTypeCounts
	const shared = () => 'count'
	const countApp = new Elysia(config)
	for (let index = 0; index < routes; index++) {
		injectExecutable(index)
		countApp.get(`/count/${index}`, shared)
	}
	void countApp.fetch
	for (let index = 0; index < routes; index++)
		await consume(
			await countApp.handle(
				new Request(`http://localhost/count/${index}`)
			)
		)
	gc()
	const countAfter = jsc.heapStats().objectTypeCounts
	const countDelta = (name: string) =>
		(countAfter[name] ?? 0) - (countBefore[name] ?? 0)

	console.log(
		JSON.stringify({
			fixture: 'runtime-lowering',
			cancellationLane,
			warmup,
			requests,
			routes,
			batch,
			allocationRequests,
			allocationContextMode,
			blockedRequests,
			blockedWarmups,
			blockedFullGcSnapshots,
			identityCallbacks: identity.length,
			samples: {
				'context-light-p50-ns': contextLightSamples,
				'context-light-bytes-per-request': [contextBytes],
				'context-light-objects-per-request': [contextObjects],
				'context-identity-mismatches': [identityMismatches],
				'lifecycle-sync-p50-ns': lifecycleSyncSamples,
				'lifecycle-async-p50-ns': lifecycleAsyncSamples,
				'q12-lifecycle-sync-p50-ns': lifecycleSyncSamples,
				'q12-lifecycle-async-p50-ns': lifecycleAsyncSamples,
				'one-header-p50-ns': oneHeaderSamples,
				'full-headers-p50-ns': fullHeadersSamples,
				'plain-404-p50-ns': plain404Samples,
				'hooked-404-p50-ns': hooked404Samples,
				'dev-422-p50-ns': dev422Samples,
				'prod-422-p50-ns': prod422Samples,
				'trace-handle-p50-ns': traceSamples,
				'after-response-sync-p50-ns': syncAfterResponseSamples,
				'after-response-async-p50-ns': asyncAfterResponseSamples,
				'blocked-before-release-current-bytes-per-request': [
					beforeReleaseDeltas.current
				],
				'blocked-before-release-heap-bytes-per-request': [
					beforeReleaseDeltas.heapSize
				],
				'blocked-before-release-extra-bytes-per-request': [
					beforeReleaseDeltas.extraMemorySize
				],
				'blocked-before-release-rss-bytes-per-request': [
					beforeReleaseDeltas.rss
				],
				'blocked-after-release-current-bytes-per-request': [
					afterReleaseDeltas.current
				],
				'blocked-after-release-heap-bytes-per-request': [
					afterReleaseDeltas.heapSize
				],
				'blocked-after-release-extra-bytes-per-request': [
					afterReleaseDeltas.extraMemorySize
				],
				'blocked-after-release-rss-bytes-per-request': [
					afterReleaseDeltas.rss
				],
				'blocked-after-abort-current-bytes-per-request': [
					afterAbortDeltas.current
				],
				'blocked-after-abort-heap-bytes-per-request': [
					afterAbortDeltas.heapSize
				],
				'blocked-after-abort-extra-bytes-per-request': [
					afterAbortDeltas.extraMemorySize
				],
				'blocked-after-abort-rss-bytes-per-request': [
					afterAbortDeltas.rss
				],
				'blocked-after-abort-release-current-bytes-per-request': [
					afterAbortReleaseDeltas.current
				],
				'blocked-after-abort-release-heap-bytes-per-request': [
					afterAbortReleaseDeltas.heapSize
				],
				'blocked-after-abort-release-extra-bytes-per-request': [
					afterAbortReleaseDeltas.extraMemorySize
				],
				'blocked-after-abort-release-rss-bytes-per-request': [
					afterAbortReleaseDeltas.rss
				],
				'runtime-Structure': [countDelta('Structure')],
				'runtime-FunctionExecutable': [
					countDelta('FunctionExecutable')
				],
				'runtime-FunctionCodeBlock': [countDelta('FunctionCodeBlock')],
				'runtime-UnlinkedFunctionExecutable': [
					countDelta('UnlinkedFunctionExecutable')
				]
			}
		})
	)
}

try {
	await main()
} catch (error) {
	console.error(error)
	process.exitCode = 1
}
