// @ts-nocheck -- exercises intentionally private retention-image state.
process.env.NODE_ENV = 'production'

const image = process.argv
	.find((argument) => argument.startsWith('--image='))
	?.slice('--image='.length)
if (image !== 'strict' && image !== 'introspect')
	throw new Error(`invalid retention image: ${image}`)

const { Elysia, t } = await import('../../src')
const { collectStaticRoutes } = await import('../../src/adapter/bun')
const { JITProbe } = await import('../../src/compile/jit-probe')
const { routeDescriptors } = await import(
	'../../src/compile/handler/descriptor'
)

class Boom extends Error {}

async function build() {
	let schema: object | undefined = t.Object({ value: t.Number() })
	// Primitive schemas are interned by TypeBox and cannot serve as a
	// reachability oracle. The unique option makes this schema instance-owned.
	let responseSchema: object | undefined = t.Number({ minimum: 0 })
	let plugin: InstanceType<typeof Elysia> | undefined = new Elysia().get(
		'/plugin',
		() => 'plugin'
	)
	const schemaRef = new WeakRef(schema)
	const responseSchemaRef = new WeakRef(responseSchema)
	const pluginRef = new WeakRef(plugin)
	const app = new Elysia({ introspect: image === 'introspect' })
		.use(plugin)
		.model('RetainedResponse', t.Object({ value: t.Number() }))
		.get('/static', 'static')
		.get('/dynamic/:id', ({ params }) => params.id)
		.post(
			'/validated',
			{
				parse: [(context) => context.request.json()],
				body: schema,
				response: responseSchema
			},
			({ body }) => body.value
		)
		.error({ Boom })
		.error(({ error }) =>
			error instanceof Boom
				? new Response('boom', { status: 503 })
				: undefined
		)
		.get('/throws', () => {
			throw new Boom()
		})
		.beforeHandle(({ request }) =>
			request.headers.get('upgrade') === 'websocket'
				? new Response('ws', { status: 418 })
				: undefined
		)
		.ws('/ws', { message() {} })
	plugin = undefined
	schema = undefined
	responseSchema = undefined
	app.compile()
	return { app, pluginRef, schemaRef, responseSchemaRef }
}

function buildExtractedWSHandler() {
	let owner: InstanceType<typeof Elysia> | undefined = new Elysia().ws(
		'/extracted-ws',
		{ message() {} }
	)
	let root: InstanceType<typeof Elysia> | undefined = new Elysia().use(owner)
	const ownerRef = new WeakRef(owner)
	const rootRef = new WeakRef(root)

	root.compile()
	const handler = root['~map']?.WS?.['/extracted-ws']
	owner = undefined
	root = undefined

	return { handler, ownerRef, rootRef }
}

async function collect() {
	const { app, pluginRef, schemaRef, responseSchemaRef } = await build()
	const extractedWS = buildExtractedWSHandler()
	const generation = app['~generation'] as any
	const nativeStatic = collectStaticRoutes(app as any)?.[0]

	JITProbe.begin()
	const dynamic = await app.handle(new Request('http://e.ly/dynamic/42'))
	const coldProbe = JITProbe.end()
	const staticResponse = await app.handle(new Request('http://e.ly/static'))
	const valid = await app.handle(
		new Request('http://e.ly/validated', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ value: 7 })
		})
	)
	const invalid = await app.handle(
		new Request('http://e.ly/validated', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ value: 'nope' })
		})
	)
	const thrown = await app.handle(new Request('http://e.ly/throws'))
	const ws = await app.handle(
		new Request('http://e.ly/ws', {
			headers: { connection: 'Upgrade', upgrade: 'websocket' }
		})
	)
	let wsUpgradeCalls = 0
	let wsPlugin: InstanceType<typeof Elysia> | undefined = new Elysia().ws(
		'/direct-ws',
		{ message() {} }
	)
	const wsPluginRef = new WeakRef(wsPlugin)
	const wsApp = new Elysia({ introspect: image === 'introspect' }).use(
		wsPlugin
	)
	wsPlugin = undefined
	wsApp.compile()
	;(wsApp['~generation'] as any).runtime.server.current = {
		upgrade() {
			wsUpgradeCalls++
			return true
		}
	}
	const wsUpgradeResult = await wsApp.handle(
		new Request('http://e.ly/direct-ws', {
			headers: { connection: 'Upgrade', upgrade: 'websocket' }
		})
	)

	for (let index = 0; index < 20; index++) {
		new Uint8Array(1024 * 1024)[0] = index
		Bun.gc(true)
		await Bun.sleep(0)
	}

	return {
		image,
		behavior: {
			dynamic: await dynamic.text(),
			static: await staticResponse.text(),
			valid: await valid.text(),
			invalidStatus: invalid.status,
			thrown: await thrown.text(),
			thrownStatus: thrown.status,
			wsHookStatus: ws?.status,
			wsUpgradeCalls,
			wsUpgradeReturned: wsUpgradeResult !== undefined,
			extractedWSHandler: typeof extractedWS.handler
		},
		coldProbe,
		generation: {
			hasRuntime: generation.runtime !== undefined,
			hasIntrospection: generation.introspection !== undefined,
			descriptorCacheDropped: routeDescriptors.get(app) === undefined,
			runtimeKeys: Object.keys(generation.runtime).sort(),
			introspectionKeys: generation.introspection
				? Object.keys(generation.introspection).sort()
				: [],
			authoringKeys: [
				'~hookChain',
				'~scopeChildren',
				'~applyMacro',
				'~ext'
			].filter((key) => key in generation),
			hasCompactRouteTable:
				generation.introspection?.routeTable !== undefined,
			compactRouteColumns: Object.keys(
				generation.introspection?.routeTable ?? {}
			).sort(),
			runtimeHasRouteTable: 'routeTable' in generation.runtime,
			introspectionRoutes: generation.introspection?.routes?.length,
			introspectionHistory: generation.introspection?.history?.length,
			introspectionModels: Object.keys(
				generation.introspection?.models ?? {}
			).sort(),
			modelsIdentity:
				generation.introspection?.models !== undefined &&
				generation.introspection.models === app.models,
			nativeStaticIdentity:
				nativeStatic !== undefined &&
				nativeStatic === generation.runtime?.nativeStatic
		},
		reachable: {
			plugin: pluginRef.deref() !== undefined,
			schema: schemaRef.deref() !== undefined,
			responseSchema: responseSchemaRef.deref() !== undefined,
			wsPlugin: wsPluginRef.deref() !== undefined,
			extractedWSRoot: extractedWS.rootRef.deref() !== undefined,
			extractedWSOwner: extractedWS.ownerRef.deref() !== undefined
		},
		authoring: {
			routeTableDropped: app['~routeTable'] === undefined,
			routesDropped: app['~routes'].length === 0,
			scopeChildrenDropped: app['~scopeChildren'] === undefined,
			hookChainDropped: app['~hookChain'] === undefined
		}
	}
}

console.log(JSON.stringify(await collect()))
