import { Elysia, file, t } from 'elysia'
import * as adapterUtils from 'elysia/adapter/utils'
import * as compiled from 'elysia/compiled'
import assertListenError from '../assert-listen-error.cjs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

if ('Bun' in globalThis) throw new Error('❌ Use Node.js to run this test!')

setTimeout(() => {
	console.log('❌ ESM Node.js timed out')
	process.exit(1)
}, 5000)

if (
	typeof adapterUtils.createResponseHandler !== 'function' ||
	typeof adapterUtils.createStreamHandler !== 'function'
)
	throw new Error('❌ ESM Node.js adapter/utils subpath failed')

if (!('validators' in compiled) || !('handlers' in compiled))
	throw new Error('❌ ESM Node.js compiled subpath failed')

assertListenError(Elysia, 'ESM')

const app = new Elysia().get(
	'/',
	{
		response: t.String()
	},
	() => 'Node.js'
)

const response = await app.handle(new Request('http://localhost'))

if ((await response.text()) !== 'Node.js') {
	throw new Error('❌ ESM Node.js failed')
}

const ct = response.headers.get('content-type')
if (!ct || !ct.startsWith('text/plain'))
	throw new Error(
		`❌ ESM Node.js: expected content-type text/plain, got ${ct}`
	)

console.log('✅ ESM Node.js works!')

const streamApp = new Elysia().get('/stream', async function* () {
	yield 'hello'
	yield ' world'
})

const streamRes = await streamApp.handle(new Request('http://localhost/stream'))
const reader = streamRes.body.getReader()
const chunks = []

while (true) {
	const { done, value } = await reader.read()
	if (done) break
	if (!(value instanceof Uint8Array))
		throw new Error(
			`❌ stream chunk is ${value?.constructor?.name ?? typeof value}, expected Uint8Array`
		)

	chunks.push(value)
}

const text = chunks.map((c) => new TextDecoder().decode(c)).join('')
if (text !== 'hello world')
	throw new Error(`❌ stream text is "${text}", expected "hello world"`)

console.log('✅ ESM Node.js stream chunks are Uint8Array')

const filePath = fileURLToPath(
	new URL('../../../package.json', import.meta.url)
)
const expectedFile = await readFile(filePath)
const fileApp = new Elysia().get('/file', file(filePath))
const fetchFile = async (range) => {
	const response = await fileApp.handle(
		new Request('http://localhost/file', {
			headers: range ? { range } : undefined
		})
	)
	const body = Buffer.from(await response.arrayBuffer())

	return { response, body }
}

for (const result of [await fetchFile(), await fetchFile()])
	if (result.response.status !== 200 || !result.body.equals(expectedFile))
		throw new Error('❌ ESM Node.js repeated file response failed')

const concurrentFiles = await Promise.all([
	fetchFile(),
	fetchFile(),
	fetchFile()
])
if (concurrentFiles.some(({ body }) => !body.equals(expectedFile)))
	throw new Error('❌ ESM Node.js concurrent file response failed')

const rangedFile = await fetchFile('bytes=2-11')
if (
	rangedFile.response.status !== 206 ||
	rangedFile.response.headers.get('content-range') !==
		`bytes 2-11/${expectedFile.length}` ||
	!rangedFile.body.equals(expectedFile.subarray(2, 12))
)
	throw new Error('❌ ESM Node.js file range response failed')

const largeFilePath = fileURLToPath(
	new URL('../../images/aris-yuzu.jpg', import.meta.url)
)
const expectedLargeFile = await readFile(largeFilePath)
const cancelFile = file(largeFilePath)
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
	throw new Error(
		`❌ ESM Node.js first file response opened ${openedFiles} streams`
	)
if (!openedFile.destroyed)
	throw new Error('❌ ESM Node.js cancelled file stream was not destroyed')
const afterCancel = await cancelApp.handle(new Request('http://localhost/file'))
if (!Buffer.from(await afterCancel.arrayBuffer()).equals(expectedLargeFile))
	throw new Error('❌ ESM Node.js cancelled file response was reused')
if (openedFiles !== 2)
	throw new Error(
		`❌ ESM Node.js second file response opened ${openedFiles} total streams`
	)

const temp = await mkdtemp(join(tmpdir(), 'elysia-file-'))
let unhandled
const onUnhandled = (error) => (unhandled = error)
try {
	const mutablePath = join(temp, 'mutable.txt')
	await writeFile(mutablePath, 'abc')
	const mutableApp = new Elysia().get('/file', file(mutablePath))
	await (await mutableApp.handle(new Request('http://localhost/file'))).text()
	await writeFile(mutablePath, 'abcdefghij')
	const changed = await mutableApp.handle(new Request('http://localhost/file'))
	if (
		changed.headers.get('content-length') !== '10' ||
		(await changed.text()) !== 'abcdefghij'
	)
		throw new Error('❌ ESM Node.js file metadata stayed stale')

	process.on('unhandledRejection', onUnhandled)
	const missingPath = join(temp, 'missing.txt')
	const missingApp = new Elysia().get('/file', file(missingPath))
	const missing = await missingApp.handle(
		new Request('http://localhost/file')
	)
	await new Promise(setImmediate)
	if (missing.status !== 500 || unhandled)
		throw new Error('❌ ESM Node.js missing file handling leaked a rejection')

	await writeFile(missingPath, 'recovered')
	const recovered = await missingApp.handle(
		new Request('http://localhost/file')
	)
	if (recovered.status !== 200 || (await recovered.text()) !== 'recovered')
		throw new Error('❌ ESM Node.js missing file did not recover')
} finally {
	process.off('unhandledRejection', onUnhandled)
	await rm(temp, { recursive: true, force: true })
}

console.log('✅ ESM Node.js file responses are repeatable and range-aware')

process.exit()
