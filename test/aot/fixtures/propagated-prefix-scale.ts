import { Elysia } from '../../../src'

const total = Number(process.argv[2] ?? 1_000)
const mode = process.argv[3] ?? 'pure'
if (!Number.isSafeInteger(total) || total < 1 || total > 10_000)
	throw new Error('propagated-prefix-scale needs 1..10000 routes')
if (mode !== 'pure' && mode !== 'mixed')
	throw new Error('propagated-prefix-scale mode must be pure or mixed')

const started = Bun.nanoseconds()
const beforeRss = process.memoryUsage().rss
const app = new Elysia()
let calls = 0

for (let i = 0; i < total; i++) {
	let plugin = new Elysia()
	if (mode === 'mixed')
		plugin = plugin.transform('plugin', () => {
			calls++
		}) as any
	plugin = plugin.beforeHandle('plugin', () => {
		calls++
	}) as any
	if (mode === 'mixed')
		plugin = plugin.afterHandle('plugin', () => {
			calls++
		}) as any
	app.use(plugin.get(`/deep-${i}`, () => i))
}

const registered = Bun.nanoseconds()
void app.fetch
const sealed = Bun.nanoseconds()
const plan = app['~generation']!.plan
const lifecycleBindings = plan.lifecycleSegments.length
const referencedSegments = new Set(
	plan.httpRoutes.flatMap(({ lifecycle }) =>
		lifecycle.map(({ segmentId }) => segmentId)
	)
).size
const response = await app.handle(`/deep-${total - 1}`)
const body = await response.text()
const requested = Bun.nanoseconds()

if (plan.coverage.plannedHttpRoutes !== total)
	throw new Error(`planned ${plan.coverage.plannedHttpRoutes}/${total} routes`)

console.log(
	JSON.stringify({
		mode,
		routes: total,
		registrationMs: (registered - started) / 1_000_000,
		sealMs: (sealed - registered) / 1_000_000,
		requestMs: (requested - sealed) / 1_000_000,
		rssDelta: process.memoryUsage().rss - beforeRss,
		externalBindings: plan.coverage.externalBindings,
		lifecycleBindings,
		referencedSegments,
		calls,
		body
	})
)
