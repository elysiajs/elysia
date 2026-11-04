// On Node `ElysiaFile.value` is a ReadStream, not a Blob: FormData would turn
// it into the string `[object Object]` and never close the opened descriptor
const { readdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const openFds = () => readdirSync('/dev/fd').length

module.exports = async (Elysia, file, form, status, t, directory, format) => {
	const a = join(directory, 'a.txt')
	const b = join(directory, 'b.png')
	const c = join(directory, 'c.txt')
	writeFileSync(a, 'first file')
	writeFileSync(b, 'second file')
	writeFileSync(c, 'third file')

	const app = new Elysia()
		.get('/single', () => form({ name: 'tea', f: file(a) }))
		.get('/async', async () => form({ f: file(a) }))
		.get('/array', () => form({ f: [file(a), file(b)] }))
		.get('/status', () => status(201, form({ f: file(a) })))
		.get('/validated', { response: t.Form({ f: t.File() }) }, () =>
			form({ f: file(a) })
		)
		.get(
			'/status-validated',
			{ response: { 201: t.Form({ f: t.Any() }) } },
			() => status(201, form({ f: file(a) }))
		)
		.get('/changed', async () => {
			const response = await form({ f: file(c) })
			writeFileSync(c, 'changed file')

			return response
		})
		.get('/missing', () => form({ f: file(join(directory, 'missing')) }))

	const get = async (path) => {
		const response = await app.handle(
			new Request(`http://localhost${path}`)
		)
		if (!response.ok)
			throw new Error(
				`❌ ${format} Node.js form ${path} answered ${response.status}`
			)

		return response.formData()
	}

	const assertFile = async (value, name, type, text, path) => {
		if (
			!(value instanceof Blob) ||
			value.name !== name ||
			!value.type.startsWith(type) ||
			(await value.text()) !== text
		)
			throw new Error(
				`❌ ${format} Node.js form ${path} sent ${value?.name} ${value?.type} ${(await value?.text?.()) ?? value}`
			)
	}

	const single = await get('/single')
	if (single.get('name') !== 'tea')
		throw new Error(`❌ ${format} Node.js form lost a string field`)

	await assertFile(
		single.get('f'),
		'a.txt',
		'text/plain',
		'first file',
		'/single'
	)

	for (const path of ['/async', '/status', '/validated', '/status-validated'])
		await assertFile(
			(await get(path)).get('f'),
			'a.txt',
			'text/plain',
			'first file',
			path
		)

	const array = (await get('/array')).getAll('f')
	if (array.length !== 2)
		throw new Error(`❌ ${format} Node.js form array has ${array.length}`)

	await assertFile(array[0], 'a.txt', 'text/plain', 'first file', '/array')
	await assertFile(array[1], 'b.png', 'image/png', 'second file', '/array')

	// a file-backed Blob here takes the whole process down
	await assertFile(
		(await get('/changed')).get('f'),
		'c.txt',
		'text/plain',
		'third file',
		'/changed'
	)

	const missing = await app.handle(new Request('http://localhost/missing'))
	if (missing.status !== 500)
		throw new Error(
			`❌ ${format} Node.js form with a missing file answered ${missing.status}`
		)

	const before = openFds()
	for (let i = 0; i < 200; i++) await (await get('/array')).get('f').text()

	await new Promise((resolve) => setTimeout(resolve, 50))

	const leaked = openFds() - before
	if (leaked > 5)
		throw new Error(
			`❌ ${format} Node.js form leaked ${leaked} descriptors`
		)

	console.log(`✅ ${format} Node.js form sends file bytes`)
}
