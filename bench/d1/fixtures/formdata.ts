import { resolve } from 'node:path'

import { integerArgument } from './utils'

const repoRoot =
	process.env.D1_ELYSIA_ROOT ?? resolve(import.meta.dir, '../../..')

function flatForm() {
	const form = new FormData()
	for (let i = 0; i < 8; i++) form.append(`field${i}`, `value${i}`)
	return form
}

async function main() {
	const warmup = integerArgument('warmup', 50)
	const requests = integerArgument('requests', 200)
	const batch = 100
	const converter = await import(
		repoRoot + '/src/adapter/web-standard/utils.ts'
	)
	const flatFastPath =
		process.env.D1_EXPERIMENTAL_FLAT_FORMDATA_FAST_PATH === '1'
	const convert = flatFastPath
		? converter.formDataToObjectFlatFastPath
		: converter.formDataToObject
	const directForm = flatForm()
	if (convert(directForm).field7 !== 'value7')
		throw new Error('FormData converter produced the wrong direct result')

	for (let i = 0; i < warmup * batch; i++) convert(directForm)
	const direct: number[] = []
	for (let sample = 0; sample < requests; sample++) {
		const started = Bun.nanoseconds()
		for (let i = 0; i < batch; i++) convert(directForm)
		direct.push((Bun.nanoseconds() - started) / batch)
	}

	const { Elysia } = await import(repoRoot + '/src/index.ts')
	const app = new Elysia({
		experimental: { flatFormDataFastPath: flatFastPath }
	}).post('/', { parse: 'formdata' }, ({ body }: any) => body.field7)
	void app.fetch
	const request = () =>
		new Request('http://localhost/', { method: 'POST', body: flatForm() })
	const preflight = await app.handle(request())
	if (preflight.status !== 200 || (await preflight.text()) !== 'value7')
		throw new Error('FormData handler produced the wrong integrated result')

	for (let i = 0; i < warmup; i++)
		await (await app.handle(request())).arrayBuffer()
	const integrated: number[] = []
	for (let i = 0; i < requests; i++) {
		const next = request()
		const started = Bun.nanoseconds()
		const response = await app.handle(next)
		await response.arrayBuffer()
		integrated.push(Bun.nanoseconds() - started)
	}

	console.log(
		JSON.stringify({
			fixture: 'formdata',
			warmup,
			requests,
			batch,
			samples: {
				'flat-convert-p50-ns': direct,
				'flat-handle-p50-ns': integrated
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
