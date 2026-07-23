// @ts-nocheck -- probes garbage-collector reachability of private runtime state.
process.env.NODE_ENV = 'production'

const { Elysia } = await import('../../src')
const { createFetchKernel, createFetchRuntimeImage } = await import(
	'../../src/handler/fetch'
)

let app: InstanceType<typeof Elysia> | undefined = new Elysia()
	.get('/static', () => 'static')
	.get('/dynamic/:id', ({ params }) => params.id)
app.compile()

const owner = new WeakRef(app)
const fetch = app['~generation'].fetch

// Re-planning from a production-sealed owner must derive route presence from
// the routing image, because strict retention has discarded its route table.
const runtime = createFetchRuntimeImage(app)
const rebuilt = createFetchKernel(runtime)
runtime.errorFinalizer.current = rebuilt.finalizeError
const rebuiltStaticResponse = await rebuilt.fetch(
	new Request('http://e.ly/static')
)
const rebuiltStatic = await rebuiltStaticResponse.text()

app = undefined

for (let index = 0; index < 20; index++) {
	new Uint8Array(1024 * 1024)[0] = index
	Bun.gc(true)
	await Bun.sleep(0)
}

const staticResponse = await fetch(new Request('http://e.ly/static'))
const dynamicResponse = await fetch(new Request('http://e.ly/dynamic/42'))

console.log(
	JSON.stringify({
		ownerCollected: owner.deref() === undefined,
		rebuiltStatic,
		static: await staticResponse.text(),
		dynamic: await dynamicResponse.text()
	})
)
