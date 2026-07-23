// @ts-nocheck -- probes garbage-collector reachability of private compiler state.
process.env.NODE_ENV = 'production'
process.env.D1_VALIDATION_LANE = 'oracle'
delete process.env.ELYSIA_AOT_BUILD

const { Elysia, t } = await import('../../src')
const { getCompilerSession } = await import('../../src/compile/aot')

const retained: unknown[] = []
const watched: Array<[string, WeakRef<object>]> = []
const watch = (name: string, value: object | undefined) => {
	if (value) watched.push([name, new WeakRef(value)])
}

function watchChain(name: string, root: any, seen = new Set<object>()) {
	if (!root || seen.has(root)) return
	seen.add(root)
	watch(name, root)
	if ('added' in root) {
		watch(`${name}:added`, root.added)
		watchChain(`${name}:parent`, root.parent, seen)
	} else {
		watchChain(`${name}:combine`, root.combine, seen)
		watchChain(`${name}:over`, root.over, seen)
	}
}

function makeSessionObserver() {
	let reference: WeakRef<object> | undefined
	const handler = () => 'session'
	Object.defineProperty(handler, 'toString', {
		value() {
			const session = getCompilerSession()
			if (session && !reference) reference = new WeakRef(session)
			return "() => 'session'"
		}
	})
	return { handler, reference: () => reference }
}

const makeOpaqueHandler = (marker: { value: string }) => () => marker.value
const pluginHook = () => ({ pluginValue: 'available' })
const hookHandler = ({ pluginValue }: any) => pluginValue
const pluginHandler = () => 'plugin'
const validatedHandler = ({ body }: any) => body.value
const invalidResponseHandler = () => ({ value: 'wrong' })
const throwingHandler = () => {
	throw new Error('retention boom')
}

function build() {
	let bodySchema: any = t.Object(
		{ value: t.Number({ minimum: 1 }) },
		{ title: 'caller-body-retention-probe' }
	)
	let responseSchema: any = t.Object(
		{ value: t.Number() },
		{ title: 'caller-response-retention-probe' }
	)
	watch('schema:caller:body', bodySchema)
	watch('schema:caller:response', responseSchema)

	const opaqueMarker = { value: 'opaque-user-binding' }
	const opaqueMarkerRef = new WeakRef(opaqueMarker)
	const sessionObserver = makeSessionObserver()
	let plugin: any = new Elysia().get('/plugin', pluginHandler)
	watch('owner:route-plugin', plugin)
	for (const [index, route] of plugin['~routes'].entries())
		watch(`internal-route:plugin:${index}`, route)
	let app: any = new Elysia()
		.derive(pluginHook)
		.get('/hook', hookHandler)
		.use(plugin)
		.post('/validated', { body: bodySchema }, validatedHandler)
		.get(
			'/invalid-response',
			{ response: { 200: responseSchema } },
			invalidResponseHandler
		)
		.get('/throws', throwingHandler)
		.get('/marker', makeOpaqueHandler(opaqueMarker))
		.get('/session', sessionObserver.handler)
	watch('owner:root', app)
	watchChain('hook-chain:root', app['~hookChain'])

	for (const [index, route] of app['~routes'].entries()) {
		watch(`internal-route:root:${index}`, route)
		watch(`route-hook:local:${index}`, route[4])
		watch(`route-hook:application:${index}`, route[5])
		watchChain(`hook-chain:route:${index}`, route[6])
		if (route[1] === '/validated')
			watch('schema:registered:body', route[4]?.body)
		if (route[1] === '/invalid-response')
			watch('schema:registered:response', route[4]?.response?.[200])
	}

	app.compile()
	const generation = app['~generation']
	const sessionRef = sessionObserver.reference()
	if (!sessionRef) throw new Error('compiler session observer was not invoked')

	const compiledHandler = app['~map']?.POST?.['/validated']

	// The strict generation owns every runtime artifact through fetch/map.
	retained.push(generation, generation.fetch, compiledHandler)

	app = undefined
	plugin = undefined
	bodySchema = undefined
	responseSchema = undefined

	return {
		generation,
		sessionRef,
		opaqueMarkerRef,
		compiledHandlerType: typeof compiledHandler,
		generationFrozen: Object.isFrozen(generation),
		planRetained: generation.plan !== undefined,
		plannedHttpRoutes: generation.coverage.plannedHttpRoutes
	}
}

const artifacts = build()

for (let index = 0; index < 24; index++) {
	new Uint8Array(1024 * 1024)[0] = index
	Bun.gc(true)
	await Bun.sleep(0)
}

const valid = await artifacts.generation.fetch(
	new Request('http://e.ly/validated', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ value: 7 })
	})
)
const invalid = await artifacts.generation.fetch(
	new Request('http://e.ly/validated', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ value: 0 })
	})
)
const invalidResponse = await artifacts.generation.fetch(
	new Request('http://e.ly/invalid-response')
)
const thrown = await artifacts.generation.fetch(
	new Request('http://e.ly/throws')
)
const marker = await artifacts.generation.fetch(
	new Request('http://e.ly/marker')
)

console.log(
	JSON.stringify({
		aliveForbidden: watched
			.filter(([, reference]) => reference.deref() !== undefined)
			.map(([name]) => name),
		sessionAlive: artifacts.sessionRef.deref() !== undefined,
		opaqueUserBindingAlive: artifacts.opaqueMarkerRef.deref() !== undefined,
		artifacts: {
			generationFrozen: artifacts.generationFrozen,
			planRetained: artifacts.planRetained,
			plannedHttpRoutes: artifacts.plannedHttpRoutes,
			compiledHandler: artifacts.compiledHandlerType,
			activeCompilerSession: getCompilerSession() !== undefined
		},
		behavior: {
			valid: await valid.text(),
			invalidStatus: invalid.status,
			invalidResponseStatus: invalidResponse.status,
			thrownStatus: thrown.status,
			marker: await marker.text()
		}
	})
)
