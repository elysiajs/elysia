if ('Bun' in globalThis) throw new Error('❌ Use Node.js to run this test!')

setTimeout(() => {
	console.log('❌ CJS Node.js timed out')
	process.exit(1)
}, 5000)

const { Elysia, file, t } = require('elysia')
const adapterUtils = require('elysia/adapter/utils')
const compiled = require('elysia/compiled')
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')

if (
	typeof adapterUtils.createResponseHandler !== 'function' ||
	typeof adapterUtils.createStreamHandler !== 'function'
)
	throw new Error('❌ CommonJS Node.js adapter/utils subpath failed')

if (!('validators' in compiled) || !('handlers' in compiled))
	throw new Error('❌ CommonJS Node.js compiled subpath failed')

const app = new Elysia().get(
	'/',
	{
		response: t.String()
	},
	() => 'Node.js'
)

const main = async () => {
	const response = await app.handle(new Request('http://localhost'))

	if ((await response.text()) !== 'Node.js') {
		throw new Error('❌ CommonJS Node.js failed')
	}

	console.log('✅ CommonJS Node.js works!')

	const streamApp = new Elysia().get('/stream', async function* () {
		yield 'hello'
		yield ' world'
	})

	const streamRes = await streamApp.handle(
		new Request('http://localhost/stream')
	)
	const reader = streamRes.body.getReader()
	const chunks = []

	while (true) {
		const { done, value } = await reader.read()
		if (done) break

		if (!(value instanceof Uint8Array))
			throw new Error(
				`❌ C14: stream chunk is ${value?.constructor?.name ?? typeof value}, expected Uint8Array`
			)

		chunks.push(value)
	}

	const text = chunks.map((c) => new TextDecoder().decode(c)).join('')
	if (text !== 'hello world')
		throw new Error(
			`❌ C14: stream text is "${text}", expected "hello world"`
		)

	console.log('✅ CommonJS Node.js stream chunks are Uint8Array')

	const filePath = resolve(__dirname, '../../../package.json')
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
			throw new Error('❌ CommonJS Node.js repeated file response failed')

	const concurrentFiles = await Promise.all([
		fetchFile(),
		fetchFile(),
		fetchFile()
	])
	if (concurrentFiles.some(({ body }) => !body.equals(expectedFile)))
		throw new Error('❌ CommonJS Node.js concurrent file response failed')

	const rangedFile = await fetchFile('bytes=2-11')
	if (
		rangedFile.response.status !== 206 ||
		rangedFile.response.headers.get('content-range') !==
			`bytes 2-11/${expectedFile.length}` ||
		!rangedFile.body.equals(expectedFile.subarray(2, 12))
	)
		throw new Error('❌ CommonJS Node.js file range response failed')

	const largeFilePath = resolve(__dirname, '../../images/aris-yuzu.jpg')
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
	const cancelled = await cancelApp.handle(
		new Request('http://localhost/file')
	)
	const cancelledReader = cancelled.body.getReader()
	await cancelledReader.read()
	await cancelledReader.cancel()
	if (openedFiles !== 1)
		throw new Error(
			`❌ CommonJS Node.js first file response opened ${openedFiles} streams`
		)
	if (!openedFile.destroyed)
		throw new Error(
			'❌ CommonJS Node.js cancelled file stream was not destroyed'
		)
	const afterCancel = await cancelApp.handle(
		new Request('http://localhost/file')
	)
	if (!Buffer.from(await afterCancel.arrayBuffer()).equals(expectedLargeFile))
		throw new Error(
			'❌ CommonJS Node.js cancelled file response was reused'
		)
	if (openedFiles !== 2)
		throw new Error(
			`❌ CommonJS Node.js second file response opened ${openedFiles} total streams`
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
		const changed = await mutableApp.handle(
			new Request('http://localhost/file')
		)
		if (
			changed.headers.get('content-length') !== '10' ||
			(await changed.text()) !== 'abcdefghij'
		)
			throw new Error('❌ CommonJS Node.js file metadata stayed stale')

		process.on('unhandledRejection', onUnhandled)
		const missingPath = join(temp, 'missing.txt')
		const missingApp = new Elysia().get('/file', file(missingPath))
		const missing = await missingApp.handle(
			new Request('http://localhost/file')
		)
		await new Promise(setImmediate)
		if (missing.status !== 500 || unhandled)
			throw new Error(
				'❌ CommonJS Node.js missing file handling leaked a rejection'
			)

		await writeFile(missingPath, 'recovered')
		const recovered = await missingApp.handle(
			new Request('http://localhost/file')
		)
		if (recovered.status !== 200 || (await recovered.text()) !== 'recovered')
			throw new Error('❌ CommonJS Node.js missing file did not recover')
	} finally {
		process.off('unhandledRejection', onUnhandled)
		await rm(temp, { recursive: true, force: true })
	}

	console.log(
		'✅ CommonJS Node.js file responses are repeatable and range-aware'
	)

	process.exit()
}
main()
