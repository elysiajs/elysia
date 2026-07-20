// @ts-nocheck -- exercises intentionally private publication state.
process.env.NODE_ENV = 'production'

const { Elysia } = await import('../../src')
const { trackValidatorCompiler } = await import('../../src/validator')
const { sucroseOracle } = await import('../../src/sucrose')
const { mayReturnPromise } = await import('../../src/compile/utils')
const { mayReturnIdentifier } = await import(
	'../../src/compile/handler/descriptor'
)
const { extractDeriveKeys } = await import(
	'../../src/compile/handler/utils'
)
const { unionTracePhases } = await import('../../src/trace')

let served = 0
let rejectSeal = true
let sealCalls = 0
let analysisReads = 0

const handler = () => {
	served++
	return 'served'
}

const analysisProbe = ({ onHandle }: any) => ({ derived: onHandle })
const functionToString = Function.prototype.toString
Function.prototype.toString = function () {
	if (this === analysisProbe) analysisReads++
	return functionToString.call(this)
}

const exerciseAnalysisCaches = () => {
	sucroseOracle(analysisProbe, undefined)
	mayReturnPromise(analysisProbe)
	mayReturnIdentifier(analysisProbe)
	extractDeriveKeys(analysisProbe)
	unionTracePhases([analysisProbe])
}

// Seed all per-function authoring analysis memos. The second pass proves each
// analyzer reuses its memo before publication.
exerciseAnalysisCaches()
exerciseAnalysisCaches()

const app = new Elysia().get('/', handler)

trackValidatorCompiler(app, {
	seal() {
		sealCalls++
		if (rejectSeal) throw new Error('seal boom')
	}
})

const priorFinalize = app['~finalizeError']
const priorBoundFinalize = () => new Response('prior')
app['~runtimeBindings'].error.current = priorBoundFinalize

const failures: Array<Record<string, unknown>> = []
const attempt = async (run: () => unknown) => {
	try {
		await run()
		failures.push({ error: undefined })
	} catch (error) {
		failures.push({
			error: (error as Error).message,
			generation: app['~generation'] !== undefined,
			served,
			finalizeRestored: app['~finalizeError'] === priorFinalize,
			bindingRestored:
				app['~runtimeBindings'].error.current === priorBoundFinalize
		})
	}
}

await attempt(() => app.fetch)
await attempt(() => app.handle(new Request('http://e.ly/')))
exerciseAnalysisCaches()
const analysisReadsAfterFailure = analysisReads

rejectSeal = false
const response = await app.handle(new Request('http://e.ly/'))
exerciseAnalysisCaches()
const analysisReadsAfterSeal = analysisReads
exerciseAnalysisCaches()
Function.prototype.toString = functionToString

console.log(
	JSON.stringify({
		failures,
		sealCalls,
		analysisReadsAfterFailure,
		analysisReadsAfterSeal,
		analysisReads,
		served,
		body: await response.text(),
		generation: app['~generation'] !== undefined
	})
)
