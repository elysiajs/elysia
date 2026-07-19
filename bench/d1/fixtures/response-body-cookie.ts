import { resolve } from 'node:path'

import { gc, memorySnapshot } from '../../../example/stress/utils'
import { integerArgument } from './utils'

const repoRoot =
	process.env.D1_ELYSIA_ROOT ?? resolve(import.meta.dir, '../../..')
const candidate = process.env.D1_N2C_CANDIDATE === '1'
const responsePayload = new TextEncoder().encode('n2c-owned-response-body')
const bytePayload = new Uint8Array(256).fill(0x6b)
const cookieHeader = Array.from(
	{ length: 10 },
	(_, index) => `c${index}=v${index}`
).join('; ')

async function measure(
	warmup: number,
	requests: number,
	batch: number,
	run: () => Promise<Response>
) {
	let checksum = 0
	for (let i = 0; i < warmup * batch; i++)
		checksum += (await (await run()).arrayBuffer()).byteLength

	const samples: number[] = []
	for (let sample = 0; sample < requests; sample++) {
		const started = Bun.nanoseconds()
		for (let i = 0; i < batch; i++)
			checksum += (await (await run()).arrayBuffer()).byteLength
		samples.push((Bun.nanoseconds() - started) / batch)
	}

	if (!checksum) throw new Error('N+2c timing lane did not consume any body')
	return samples
}

function byteStream(payload: Uint8Array) {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(payload)
			controller.close()
		}
	})
}

async function expectBody(
	response: Response,
	expected: Uint8Array,
	label: string
) {
	if (response.status !== 200)
		throw new Error(`${label} returned ${response.status}`)
	const body = new Uint8Array(await response.arrayBuffer())
	if (body.length !== expected.length)
		throw new Error(`${label} returned the wrong body`)
	for (let index = 0; index < body.length; index++)
		if (body[index] !== expected[index])
			throw new Error(`${label} returned the wrong body`)
}

const deltaPerItem = (after: number, before: number, items: number) =>
	(after - before) / items

async function main() {
	const warmup = integerArgument('warmup', 50)
	const requests = integerArgument('requests', 200)
	const routes = integerArgument('routes', 1_000)
	const batch = 25
	const retainedResponses = Math.min(routes, 256)
	const retainedCookieJars = Math.min(routes, 1_000)
	const elysia = (await import(repoRoot + '/src/index.ts')) as any
	const { Elysia } = elysia
	const hasCertifiedBytes = typeof elysia.bytes === 'function'
	if (candidate && !hasCertifiedBytes)
		throw new Error('N+2c candidate did not export bytes()')
	const certifyBytes = hasCertifiedBytes
		? elysia.bytes
		: <T extends ReadableStream<Uint8Array>>(stream: T) => stream

	const ownedApp = new Elysia().get('/owned', ({ set }: any) => {
		set.headers['x-d1-patched'] = 'yes'
		return new Response(byteStream(responsePayload), {
			headers: { 'x-d1-source': 'yes' }
		})
	})
	const bytesApp = new Elysia().get('/bytes', () =>
		certifyBytes(byteStream(bytePayload))
	)
	let retainCookies = false
	const cookieJars: unknown[] = []
	const cookieApp = new Elysia().get('/cookie', ({ cookie }: any) => {
		const value = cookie.c0.value
		if (retainCookies) cookieJars.push(cookie)
		return value
	})
	void ownedApp.fetch
	void bytesApp.fetch
	void cookieApp.fetch

	const ownedRequest = new Request('http://localhost/owned')
	const bytesRequest = new Request('http://localhost/bytes')
	const cookieRequest = new Request('http://localhost/cookie', {
		headers: { cookie: cookieHeader }
	})
	const ownedRun = () => ownedApp.handle(ownedRequest)
	const bytesRun = () => bytesApp.handle(bytesRequest)
	const cookieRun = () => cookieApp.handle(cookieRequest)

	const ownedPreflight = await ownedRun()
	if (
		ownedPreflight.headers.get('x-d1-patched') !== 'yes' ||
		ownedPreflight.headers.get('x-d1-source') !== 'yes'
	)
		throw new Error('owned Response patching lost a header')
	await expectBody(ownedPreflight, responsePayload, 'owned Response')
	const bytesPreflight = await bytesRun()
	if (
		hasCertifiedBytes &&
		bytesPreflight.headers.get('content-type') !==
			'application/octet-stream'
	)
		throw new Error('certified byte stream omitted its content type')
	await expectBody(bytesPreflight, bytePayload, 'byte stream')
	const cookiePreflight = await cookieRun()
	if ((await cookiePreflight.text()) !== 'v0')
		throw new Error('ten-cookie/read-one lane returned the wrong cookie')

	const ownedSamples = await measure(warmup, requests, batch, ownedRun)
	const byteSamples = await measure(warmup, requests, batch, bytesRun)
	const cookieSamples = await measure(warmup, requests, batch, cookieRun)

	gc()
	const responseBefore = memorySnapshot()
	const pendingResponses: Response[] = []
	for (let index = 0; index < retainedResponses; index++)
		pendingResponses.push(await ownedRun())
	const responseAfter = memorySnapshot()
	const responseHeapBytes = deltaPerItem(
		responseAfter.heapSize ?? 0,
		responseBefore.heapSize ?? 0,
		retainedResponses
	)
	const responseObjects = deltaPerItem(
		responseAfter.objectCount ?? 0,
		responseBefore.objectCount ?? 0,
		retainedResponses
	)
	for (const response of pendingResponses) {
		if (response.headers.get('x-d1-patched') !== 'yes')
			throw new Error('retained owned Response lost its patch')
		await expectBody(response, responsePayload, 'retained owned Response')
	}
	pendingResponses.length = 0
	gc()

	const cookieBefore = memorySnapshot()
	retainCookies = true
	for (let index = 0; index < retainedCookieJars; index++) {
		const response = await cookieRun()
		if ((await response.text()) !== 'v0')
			throw new Error(
				'retained cookie-jar lane returned the wrong cookie'
			)
	}
	retainCookies = false
	if (cookieJars.length !== retainedCookieJars)
		throw new Error('cookie-jar retention count mismatch')
	const cookieAfter = memorySnapshot()
	const cookieHeapBytes = deltaPerItem(
		cookieAfter.heapSize ?? 0,
		cookieBefore.heapSize ?? 0,
		retainedCookieJars
	)
	const cookieObjects = deltaPerItem(
		cookieAfter.objectCount ?? 0,
		cookieBefore.objectCount ?? 0,
		retainedCookieJars
	)
	cookieJars.length = 0
	gc()

	console.log(
		JSON.stringify({
			fixture: 'response-body-cookie',
			candidate,
			hasCertifiedBytes,
			warmup,
			requests,
			routes,
			batch,
			retainedResponses,
			retainedCookieJars,
			samples: {
				'owned-patched-response-p50-ns': ownedSamples,
				'owned-patched-response-retained-heap-bytes-per-request': [
					responseHeapBytes
				],
				'owned-patched-response-retained-objects-per-request': [
					responseObjects
				],
				'certified-byte-stream-p50-ns': byteSamples,
				'cookie-ten-read-one-p50-ns': cookieSamples,
				'cookie-ten-read-one-retained-heap-bytes-per-request': [
					cookieHeapBytes
				],
				'cookie-ten-read-one-retained-objects-per-request': [
					cookieObjects
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
