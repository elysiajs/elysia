import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

if ('Bun' in globalThis) throw new Error('Use Node.js to run this test')

const require = createRequire(import.meta.url)
const packageFile = fileURLToPath(new URL('../../package.json', import.meta.url))
const largeFile = fileURLToPath(
	new URL('../images/aris-yuzu.jpg', import.meta.url)
)

const run = async (label, { Elysia, file, t }, adapterUtils, compiled) => {
	if (
		typeof adapterUtils.createResponseHandler !== 'function' ||
		typeof adapterUtils.createStreamHandler !== 'function'
	)
		throw new Error(`${label}: adapter/utils subpath failed`)
	if (!('validators' in compiled) || !('handlers' in compiled))
		throw new Error(`${label}: compiled subpath failed`)

	const app = new Elysia().get(
		'/',
		{ response: t.String() },
		() => 'Node.js'
	)
	const response = await app.handle(new Request('http://localhost'))
	if ((await response.text()) !== 'Node.js')
		throw new Error(`${label}: basic response failed`)
	if (!response.headers.get('content-type')?.startsWith('text/plain'))
		throw new Error(`${label}: expected text/plain content-type`)

	const streamApp = new Elysia().get('/stream', async function* () {
		yield 'hello'
		yield ' world'
	})
	const streamResponse = await streamApp.handle(
		new Request('http://localhost/stream')
	)
	const reader = streamResponse.body.getReader()
	const chunks = []
	while (true) {
		const { done, value } = await reader.read()
		if (done) break
		if (!(value instanceof Uint8Array))
			throw new Error(`${label}: stream chunk is not Uint8Array`)
		chunks.push(value)
	}
	if (
		chunks.map((chunk) => new TextDecoder().decode(chunk)).join('') !==
		'hello world'
	)
		throw new Error(`${label}: stream content failed`)

	const expectedFile = await readFile(packageFile)
	const fileApp = new Elysia().get('/file', file(packageFile))
	const fetchFile = async (range) => {
		const response = await fileApp.handle(
			new Request('http://localhost/file', {
				headers: range ? { range } : undefined
			})
		)
		return { response, body: Buffer.from(await response.arrayBuffer()) }
	}

	for (const result of [await fetchFile(), await fetchFile()])
		if (result.response.status !== 200 || !result.body.equals(expectedFile))
			throw new Error(`${label}: repeated file response failed`)

	const concurrent = await Promise.all([fetchFile(), fetchFile(), fetchFile()])
	if (concurrent.some(({ body }) => !body.equals(expectedFile)))
		throw new Error(`${label}: concurrent file response failed`)

	const ranged = await fetchFile('bytes=2-11')
	if (
		ranged.response.status !== 206 ||
		ranged.response.headers.get('content-range') !==
			`bytes 2-11/${expectedFile.length}` ||
		!ranged.body.equals(expectedFile.subarray(2, 12))
	)
		throw new Error(`${label}: range response failed`)

	const expectedLargeFile = await readFile(largeFile)
	const cancelFile = file(largeFile)
	const openFile = Object.getOwnPropertyDescriptor(
		Object.getPrototypeOf(cancelFile),
		'value'
	).get
	let openedFile
	let openedFiles = 0
	Object.defineProperty(cancelFile, 'value', {
		get: () => {
			openedFiles++
			return (openedFile = openFile.call(cancelFile))
		}
	})
	const cancelApp = new Elysia().get('/file', cancelFile)
	const cancelled = await cancelApp.handle(new Request('http://localhost/file'))
	const cancelledReader = cancelled.body.getReader()
	await cancelledReader.read()
	await cancelledReader.cancel()
	if (openedFiles !== 1)
		throw new Error(`${label}: first response opened ${openedFiles} streams`)
	if (!openedFile.destroyed)
		throw new Error(`${label}: cancelled file stream was not destroyed`)
	const afterCancel = await cancelApp.handle(new Request('http://localhost/file'))
	if (!Buffer.from(await afterCancel.arrayBuffer()).equals(expectedLargeFile))
		throw new Error(`${label}: cancelled file response was reused`)
	if (openedFiles !== 2)
		throw new Error(`${label}: second response opened ${openedFiles} streams`)

	const temp = await mkdtemp(join(tmpdir(), 'elysia-file-'))
	let unhandled
	const onUnhandled = (error) => (unhandled = error)
	try {
		const mutablePath = join(temp, 'mutable.txt')
		await writeFile(mutablePath, 'abc')
		const mutableApp = new Elysia().get('/file', file(mutablePath))
		await (await mutableApp.handle(new Request('http://localhost/file'))).text()
		await writeFile(mutablePath, 'abcdefghij')
		const changed = await mutableApp.handle(
			new Request('http://localhost/file')
		)
		if (
			changed.headers.get('content-length') !== '10' ||
			(await changed.text()) !== 'abcdefghij'
		)
			throw new Error(`${label}: file metadata stayed stale`)

		process.on('unhandledRejection', onUnhandled)
		const missingPath = join(temp, 'missing.txt')
		const missingApp = new Elysia().get('/file', file(missingPath))
		const missing = await missingApp.handle(
			new Request('http://localhost/file')
		)
		await new Promise(setImmediate)
		if (missing.status !== 500 || unhandled)
			throw new Error(`${label}: missing file leaked a rejection`)

		await writeFile(missingPath, 'recovered')
		const recovered = await missingApp.handle(
			new Request('http://localhost/file')
		)
		if (recovered.status !== 200 || (await recovered.text()) !== 'recovered')
			throw new Error(`${label}: missing file did not recover`)
	} finally {
		process.off('unhandledRejection', onUnhandled)
		await rm(temp, { recursive: true, force: true })
	}

	console.log(`Node.js ${label} exports work`)
}

const timeout = setTimeout(() => {
	console.error('Node.js test timed out')
	process.exit(1)
}, 10_000)

await run(
	'ESM',
	await import('elysia'),
	await import('elysia/adapter/utils'),
	await import('elysia/compiled')
)
await run(
	'CommonJS',
	require('elysia'),
	require('elysia/adapter/utils'),
	require('elysia/compiled')
)

clearTimeout(timeout)
