import { Elysia } from '../../src'
import { environment, gc, median } from './utils'

const url = 'http://localhost/'
const batchSize = 50_000
const repetitions = 7
const warmupSize = 2_000

const apps = {
	plain: new Elysia().get('/', () => 'ok'),
	request: new Elysia().request(() => {}).get('/', () => 'ok'),
	beforeHandle: new Elysia().beforeHandle(() => {}).get('/', () => 'ok'),
	combined: new Elysia()
		.request(() => {})
		.beforeHandle(() => {})
		.get('/', () => 'ok')
}

type Variant = keyof typeof apps
const variants = Object.keys(apps) as Variant[]
const fetches = Object.fromEntries(
	variants.map((variant) => [variant, apps[variant].fetch])
) as Record<Variant, (request: Request) => Response | Promise<Response>>

const controller = new AbortController()
controller.abort()
if (!controller.signal.aborted)
	throw new Error('AbortSignal.aborted was not exposed synchronously')

const validate = (variant: Variant, response: Response) => {
	if (response.status !== 200)
		throw new Error(`${variant} returned status ${response.status}`)
}

const listenerCounts = {} as Record<Variant, number>
for (const variant of variants) {
	const request = new Request(url)
	const signal = request.signal
	const addEventListener = signal.addEventListener.bind(signal)
	let count = 0

	signal.addEventListener = ((type: string, ...args: any[]) => {
		if (type === 'abort') count++
		return addEventListener(type, ...args)
	}) as typeof signal.addEventListener

	validate(variant, await apps[variant].handle(request))
	listenerCounts[variant] = count

	for (let i = 0; i < warmupSize; i++)
		fetches[variant](new Request(url))
}

const samples = Object.fromEntries(
	variants.map((variant) => [variant, [] as number[]])
) as Record<Variant, number[]>

for (let repetition = 0; repetition < repetitions; repetition++)
	for (const variant of repetition % 2 ? variants.toReversed() : variants) {
		gc()
		const started = performance.now()
		let response: Response | Promise<Response> | undefined

		for (let i = 0; i < batchSize; i++)
			response = fetches[variant](new Request(url))

		samples[variant].push(
			((performance.now() - started) * 1_000_000) / batchSize
		)

		if (!(response instanceof Response))
			throw new Error(`${variant} fetch was not synchronous`)
		validate(variant, response)
	}

const result = {
	environment: environment(),
	batchSize,
	repetitions,
	variants: Object.fromEntries(
		variants.map((variant) => [
			variant,
			{
				samplesNsPerRequest: samples[variant],
				medianNsPerRequest: median(samples[variant]),
				abortListenerCount: listenerCounts[variant]
			}
		])
	)
}

if (process.argv.includes('--json')) console.log(JSON.stringify(result))
else console.log(result)
