import { resolve } from 'node:path'

import { gc, memorySnapshot } from '../../../example/stress/utils'
import { integerArgument } from './utils'

const repoRoot =
	process.env.D1_ELYSIA_ROOT ?? resolve(import.meta.dir, '../../..')
const validationLane = process.env.D1_VALIDATION_LANE ?? 'oracle'

if (
	validationLane !== 'oracle' &&
	validationLane !== 'candidate' &&
	validationLane !== 'query-oracle'
)
	throw new Error(`invalid D1 validation lane: ${validationLane}`)

function measure<T>(
	warmup: number,
	requests: number,
	batch: number,
	run: (index: number) => T
) {
	let last!: T
	for (let i = 0; i < warmup * batch; i++) last = run(i)

	const samples: number[] = []
	for (let sample = 0; sample < requests; sample++) {
		const started = Bun.nanoseconds()
		for (let i = 0; i < batch; i++) last = run(sample * batch + i)
		samples.push((Bun.nanoseconds() - started) / batch)
	}

	return { last, samples }
}

async function measureRoute(
	app: { handle(request: Request): Promise<Response> },
	url: string,
	warmup: number,
	requests: number,
	batch: number
) {
	const request = new Request(url)
	for (let i = 0; i < warmup * batch; i++) await app.handle(request)

	const samples: number[] = []
	for (let sample = 0; sample < requests; sample++) {
		const started = Bun.nanoseconds()
		for (let i = 0; i < batch; i++) await app.handle(request)
		samples.push((Bun.nanoseconds() - started) / batch)
	}
	return samples
}

const executableSnapshot = (jsc: typeof import('bun:jsc')) => {
	const counts = jsc.heapStats().objectTypeCounts
	return {
		functionExecutable: counts.FunctionExecutable ?? 0,
		functionCodeBlock: counts.FunctionCodeBlock ?? 0,
		unlinkedFunctionExecutable: counts.UnlinkedFunctionExecutable ?? 0
	}
}

function pathologicalHandler(nonce: number) {
	const target = 31 * 1024
	const emptyLength = new Function('c', '').toString().length
	const prefix = `void ${String(nonce).padStart(6, '0')};let a0=c;`
	const bodyLength = target - emptyLength
	let body = prefix
	let alias = 0
	while (true) {
		const next = alias + 1
		const assignment = `let a${next}=a${alias};`
		const suffix = `return a${next}.query`
		if (body.length + assignment.length + suffix.length > bodyLength) break
		body += assignment
		alias = next
	}
	const suffix = `return a${alias}.query`
	const handler = new Function(
		'c',
		body + ' '.repeat(bodyLength - body.length - suffix.length) + suffix
	)

	if (handler.toString().length !== target)
		throw new Error('pathological inference handler is not 31 KiB')

	return handler
}

async function main() {
	const warmup = integerArgument('warmup', 50)
	const requests = integerArgument('requests', 200)
	const validators = integerArgument('routes', 1_000)
	const batch = 100
	const [
		elysiaModule,
		typeModule,
		routeModule,
		validatorModule,
		errorModule,
		validationPlanModule,
		sucroseModule,
		jsc
	] = await Promise.all([
		import(repoRoot + '/src/index.ts'),
		import(repoRoot + '/src/type/index.ts'),
		import(repoRoot + '/src/validator/route.ts'),
		import(repoRoot + '/src/validator/index.ts'),
		import(repoRoot + '/src/error.ts'),
		import(repoRoot + '/src/experimental/validation-plan.ts'),
		import(repoRoot + '/src/sucrose.ts'),
		import('bun:jsc')
	])
	const { t } = typeModule
	const { Elysia } = elysiaModule
	const { RouteValidator } = routeModule
	const { Validator } = validatorModule
	const { ValidationError } = errorModule
	const { validationPlan, ValidationPlanValidator } = validationPlanModule
	const queryOraclePlan: any = { ...validationPlan }
	const queryRoutePlan =
		validationLane === 'candidate'
			? validationPlan
			: validationLane === 'query-oracle'
				? queryOraclePlan
				: undefined
	const validationOptions = {
		normalize: true as const,
		validationPlan:
			validationLane === 'candidate' ? validationPlan : undefined
	}
	const implementations = {
		validation: routeModule.D1_VALIDATION_IMPLEMENTATION ?? 'oracle',
		inference: sucroseModule.D1_INFERENCE_IMPLEMENTATION ?? 'oracle'
	}
	if (
		validationLane === 'candidate' &&
		(implementations.validation !== 'candidate' ||
			implementations.inference !== 'candidate')
	)
		throw new Error(
			`validation lane ${validationLane} is unavailable: ${JSON.stringify(implementations)}`
		)

	const scalar = new RouteValidator(
		{
			query: t.Object({
				page: t.Number(),
				active: t.Boolean(),
				limit: t.Integer()
			})
		},
		validationOptions
	).query as any
	const objectString = new RouteValidator(
		{
			query: t.Object({
				filter: t.ObjectString({
					take: t.Number(),
					enabled: t.Boolean()
				})
			})
		},
		validationOptions
	).query as any
	const arrayString = new RouteValidator(
		{ query: t.Object({ ids: t.ArrayString(t.Number()) }) },
		validationOptions
	).query as any
	const body = new RouteValidator(
		{
			body: t.Object({
				user: t.Object({ name: t.String(), age: t.Number() }),
				tags: t.Array(t.String())
			})
		},
		validationOptions
	).body as any
	const shapeImplementations = {
		scalar:
			scalar instanceof ValidationPlanValidator ? 'candidate' : 'oracle',
		objectString:
			objectString instanceof ValidationPlanValidator
				? 'candidate'
				: 'oracle',
		arrayString:
			arrayString instanceof ValidationPlanValidator
				? 'candidate'
				: 'oracle',
		body: body instanceof ValidationPlanValidator ? 'candidate' : 'oracle'
	}
	if (
		validationLane === 'candidate' &&
		(shapeImplementations.scalar !== 'candidate' ||
			shapeImplementations.objectString !== 'candidate' ||
			shapeImplementations.arrayString !== 'candidate' ||
			shapeImplementations.body !== 'oracle')
	)
		throw new Error(
			`unexpected validation plan selection: ${JSON.stringify(shapeImplementations)}`
		)

	const scalarInput = { page: '42', active: 'true', limit: '10' }
	const objectStringInput = {
		filter: '{"take":2,"enabled":true}'
	}
	const arrayStringInput = { ids: '[1,2,3,4]' }
	const bodyInput = {
		user: { name: 'elysia', age: 7 },
		tags: ['fast', 'small'],
		extra: 'drop'
	}
	const invalidQueryInput = {
		page: 'bad',
		active: 'true',
		limit: '10'
	}
	const materializeQueryError = (error: any) => {
		if (!(error instanceof ValidationError)) throw error
		if (error.type !== 'query')
			throw new Error(`invalid query fixture rejected on ${error.type}`)
		const issues = error.errors
		if (!Array.isArray(issues) || !issues.length)
			throw new Error('invalid query fixture materialized no issues')
		const pageIssues = issues.filter(
			(issue: any) => issue?.instancePath === '/page'
		)
		if (!pageIssues.length)
			throw new Error('invalid query fixture did not reject /page')
		return pageIssues.length
	}

	const scalarTiming = measure(warmup, requests, batch, () =>
		scalar.FromSync(scalarInput, 'query')
	)
	const objectStringTiming = measure(warmup, requests, batch, () =>
		objectString.FromSync(objectStringInput, 'query')
	)
	const arrayStringTiming = measure(warmup, requests, batch, () =>
		arrayString.FromSync(arrayStringInput, 'query')
	)
	const bodyTiming = measure(warmup, requests, batch, () =>
		body.FromSync(bodyInput, 'body')
	)
	const invalidQueryTiming = measure(warmup, requests, batch, () => {
		try {
			scalar.FromSync(invalidQueryInput, 'query')
		} catch (error: any) {
			return materializeQueryError(error)
		}
		return 0
	})

	const routeApp = new Elysia({
		experimental: {
			validationPlan: queryRoutePlan
		}
	}).get(
		'/query-plan',
		{
			query: t.Object({
				name: t.String(),
				page: t.Number(),
				limit: t.Integer(),
				active: t.Boolean()
			})
		},
		({ query }: any) => query.page + query.limit
	)
	void routeApp.fetch
	const routeBatch = 100
	const routeQueryTiming = await measureRoute(
		routeApp,
		'http://localhost/query-plan?name=elysia&page=2&limit=20&active=true',
		warmup,
		requests,
		routeBatch
	)
	const repeatedRouteQueryTiming = await measureRoute(
		routeApp,
		'http://localhost/query-plan?name=elysia&page=1&page=2&limit=10&limit=20&active=true',
		warmup,
		requests,
		routeBatch
	)
	const invalidRouteQueryTiming = await measureRoute(
		routeApp,
		'http://localhost/query-plan?name=elysia&page=bad&limit=20&active=true',
		warmup,
		requests,
		routeBatch
	)
	const routeResult = await routeApp.handle(
		new Request(
			'http://localhost/query-plan?name=elysia&page=1&page=2&limit=10&limit=20&active=true'
		)
	)
	if (routeResult.status !== 200 || (await routeResult.text()) !== '22')
		throw new Error('query route fixture produced the wrong result')
	const invalidRouteResult = await routeApp.handle(
		new Request(
			'http://localhost/query-plan?name=elysia&page=bad&limit=20&active=true'
		)
	)
	if (
		invalidRouteResult.status !== 422 ||
		!(await invalidRouteResult.text()).includes('/page')
	)
		throw new Error('query route fixture did not materialize the invalid error')

	const scalarResult = scalarTiming.last as any
	const objectStringResult = objectStringTiming.last as any
	const arrayStringResult = arrayStringTiming.last as any
	const bodyResult = bodyTiming.last as any
	if (
		scalarResult.page !== 42 ||
		scalarResult.active !== true ||
		scalarResult.limit !== 10 ||
		objectStringResult.filter.take !== 2 ||
		objectStringResult.filter.enabled !== true ||
		arrayStringResult.ids[3] !== 4 ||
		bodyResult.user.name !== 'elysia' ||
		'extra' in bodyResult
	)
		throw new Error(
			'validation fixture produced the wrong normalized result'
		)
	if (invalidQueryTiming.last < 1)
		throw new Error(
			'invalid query fixture did not reject and materialize errors'
		)
	if (
		invalidQueryInput.page !== 'bad' ||
		invalidQueryInput.active !== 'true' ||
		invalidQueryInput.limit !== '10'
	)
		throw new Error('invalid query fixture mutated its shared input')

	const inferenceWarmup = 1
	const inferenceRequests = Math.min(requests, 5)
	const inferenceHandlers = Array.from(
		{ length: inferenceWarmup + inferenceRequests },
		(_, index) => pathologicalHandler(index)
	)
	const inferenceValue = (inferred: any) =>
		Number(inferred.query) |
		(Number(inferred.headers) << 1) |
		(Number(inferred.body) << 2) |
		(Number(inferred.cookie) << 3) |
		(Number(inferred.set) << 4) |
		(Number(inferred.route) << 5)
	let inferenceSink = 0
	for (let i = 0; i < inferenceWarmup; i++) {
		const inferred = sucroseModule.sucrose(
			inferenceHandlers[i] as any,
			undefined
		)
		inferenceSink += inferenceValue(inferred)
	}
	const inferenceSamples: number[] = []
	for (let i = 0; i < inferenceRequests; i++) {
		const started = Bun.nanoseconds()
		const inferred = sucroseModule.sucrose(
			inferenceHandlers[inferenceWarmup + i] as any,
			undefined
		)
		inferenceSamples.push(Bun.nanoseconds() - started)
		inferenceSink += inferenceValue(inferred)
	}
	if (inferenceSink !== inferenceWarmup + inferenceRequests)
		throw new Error('pathological handler inference lost exact flag parity')
	sucroseModule.clearSucroseCache()

	const constructionSchemas = Array.from(
		{ length: warmup + requests },
		(_, index) =>
			t.Object({
				page: t.Number({ minimum: -index - 1 }),
				active: t.Boolean(),
				limit: t.Integer()
			})
	)
	const constructed: any[] = []
	for (let i = 0; i < warmup; i++)
		constructed.push(
			new RouteValidator(
				{ query: constructionSchemas[i] },
				validationOptions
			).query
		)
	const constructionSamples: number[] = []
	for (let i = 0; i < requests; i++) {
		const started = Bun.nanoseconds()
		constructed.push(
			new RouteValidator(
				{ query: constructionSchemas[warmup + i] },
				validationOptions
			).query
		)
		constructionSamples.push(Bun.nanoseconds() - started)
	}
	if (new Set(constructed).size !== constructed.length)
		throw new Error(
			'validator construction fixture hit the structural cache'
		)
	const constructionResult = constructed
		.at(-1)
		.FromSync(scalarInput, 'query') as any
	if (constructionResult.page !== 42)
		throw new Error('constructed validator produced the wrong result')

	const bodyConstructionSchemas = Array.from(
		{ length: warmup + requests },
		(_, index) =>
			t.Object({
				user: t.Object({
					name: t.String(),
					age: t.Number({ minimum: -index - 1 })
				}),
				tags: t.Array(t.String())
			})
	)
	const bodyConstructionBeforeCurrent = jsc.memoryUsage().current
	let bodyConstructionHighwaterCurrent = bodyConstructionBeforeCurrent
	const bodyConstructed: any[] = []
	for (let i = 0; i < warmup; i++) {
		bodyConstructed.push(
			new RouteValidator(
				{ body: bodyConstructionSchemas[i] },
				validationOptions
			).body
		)
		if ((i & 31) === 31)
			bodyConstructionHighwaterCurrent = Math.max(
				bodyConstructionHighwaterCurrent,
				jsc.memoryUsage().current
			)
	}
	const bodyConstructionSamples: number[] = []
	for (let i = 0; i < requests; i++) {
		const started = Bun.nanoseconds()
		bodyConstructed.push(
			new RouteValidator(
				{ body: bodyConstructionSchemas[warmup + i] },
				validationOptions
			).body
		)
		bodyConstructionSamples.push(Bun.nanoseconds() - started)
		if ((i & 31) === 31)
			bodyConstructionHighwaterCurrent = Math.max(
				bodyConstructionHighwaterCurrent,
				jsc.memoryUsage().current
			)
	}
	bodyConstructionHighwaterCurrent = Math.max(
		bodyConstructionHighwaterCurrent,
		jsc.memoryUsage().current
	)
	if (new Set(bodyConstructed).size !== bodyConstructed.length)
		throw new Error(
			'body validator construction fixture hit the structural cache'
		)
	const bodyConstructionResult = bodyConstructed
		.at(-1)
		.FromSync(bodyInput, 'body') as any
	if (bodyConstructionResult.user.age !== 7)
		throw new Error('constructed body validator produced the wrong result')

	constructed.length = 0
	constructionSchemas.length = 0
	bodyConstructed.length = 0
	bodyConstructionSchemas.length = 0
	Validator.clear()
	gc()

	const queryPlanConstructionSchemas = Array.from(
		{ length: warmup + requests },
		(_, index) =>
			t.Object({
				name: t.String({ description: String(index) }),
				page: t.Number(),
				limit: t.Integer(),
				active: t.Boolean()
			})
	)
	const queryPlanConstructed: any[] = []
	for (let i = 0; i < warmup; i++)
		queryPlanConstructed.push(
			new RouteValidator(
				{ query: queryPlanConstructionSchemas[i] },
				{ normalize: true, validationPlan: queryRoutePlan }
			)
		)
	const queryPlanConstructionSamples: number[] = []
	for (let i = 0; i < requests; i++) {
		const started = Bun.nanoseconds()
		queryPlanConstructed.push(
			new RouteValidator(
				{ query: queryPlanConstructionSchemas[warmup + i] },
				{ normalize: true, validationPlan: queryRoutePlan }
			)
		)
		queryPlanConstructionSamples.push(Bun.nanoseconds() - started)
	}
	queryPlanConstructed.length = 0
	queryPlanConstructionSchemas.length = 0
	Validator.clear()
	gc()

	const retainedSchemas = Array.from({ length: validators }, (_, index) =>
		t.Object({
			page: t.Number({ minimum: -index - 1 }),
			active: t.Boolean(),
			limit: t.Integer()
		})
	)
	const before = memorySnapshot()
	const beforeRss = process.memoryUsage().rss
	let highwaterCurrent = before.current
	let retainedSink = 0
	const retainedValidators: any[] = []
	for (let i = 0; i < validators; i++) {
		const validator = new RouteValidator(
			{ query: retainedSchemas[i] },
			validationOptions
		).query as any
		retainedValidators.push(validator)
		retainedSink += validator.FromSync(scalarInput, 'query').page
		if ((i & 31) === 31)
			highwaterCurrent = Math.max(
				highwaterCurrent,
				jsc.memoryUsage().current
			)
	}
	if (new Set(retainedValidators).size !== validators)
		throw new Error('retained validator fixture hit the structural cache')
	highwaterCurrent = Math.max(highwaterCurrent, jsc.memoryUsage().current)
	gc()
	const after = memorySnapshot()
	highwaterCurrent = Math.max(highwaterCurrent, after.current)
	const afterRss = process.memoryUsage().rss
	const afterExecutables = executableSnapshot(jsc)
	if (retainedSink !== validators * 42)
		throw new Error('retained validators produced the wrong result')

	let rejectedQueries = 0
	let queryErrorChecksum = 0
	for (const validator of retainedValidators)
		try {
			validator.FromSync(invalidQueryInput, 'query')
		} catch (error: any) {
			rejectedQueries++
			queryErrorChecksum += materializeQueryError(error)
		}
	if (rejectedQueries !== validators)
		throw new Error(
			'retained query validators did not all reject invalid input'
		)
	if (queryErrorChecksum < validators)
		throw new Error('retained query errors produced an invalid checksum')
	if (
		invalidQueryInput.page !== 'bad' ||
		invalidQueryInput.active !== 'true' ||
		invalidQueryInput.limit !== '10'
	)
		throw new Error('retained query validators mutated their shared input')
	gc()
	const afterQueryErrors = memorySnapshot()
	const afterQueryErrorRss = process.memoryUsage().rss
	const afterQueryErrorExecutables = executableSnapshot(jsc)

	retainedValidators.length = 0
	retainedSchemas.length = 0
	Validator.clear()
	gc()

	const queryPlanSchemas = Array.from({ length: validators }, (_, index) =>
		t.Object({
			name: t.String({ description: String(index) }),
			page: t.Number(),
			limit: t.Integer(),
			active: t.Boolean()
		})
	)
	const queryPlanBefore = memorySnapshot()
	const queryPlanBeforeRss = process.memoryUsage().rss
	const retainedQueryRoutes = queryPlanSchemas.map(
		(query) =>
			new RouteValidator(
				{ query },
				{ normalize: true, validationPlan: queryRoutePlan }
			)
	)
	const fusedQueryPlans = retainedQueryRoutes.filter(
		(route) => route.queryPlan?.fused
	).length
	if (
		(validationLane === 'candidate' && fusedQueryPlans !== validators) ||
		(validationLane !== 'candidate' && fusedQueryPlans !== 0)
	)
		throw new Error('query plan retention fixture selected the wrong lane')
	gc()
	const queryPlanAfter = memorySnapshot()
	const queryPlanAfterRss = process.memoryUsage().rss

	let rejectedQueryPlans = 0
	for (const route of retainedQueryRoutes)
		try {
			if (route.queryPlan?.fused) {
				const url =
					'http://localhost/query-plan?name=elysia&page=bad&limit=20&active=true'
				const query = route.queryPlan.fromURL!(url, url.indexOf('?'))
				route.queryPlan.validate!(query, route.query as any)
			} else {
				;(route.query as any).FromSync(
					{
						name: 'elysia',
						page: 'bad',
						limit: '20',
						active: 'true'
					},
					'query'
				)
			}
		} catch {
			rejectedQueryPlans++
		}
	if (rejectedQueryPlans !== validators)
		throw new Error('query plan retention fixture accepted invalid input')
	gc()
	const queryPlanAfterErrors = memorySnapshot()
	retainedQueryRoutes.length = 0
	queryPlanSchemas.length = 0
	Validator.clear()
	gc()

	const reusedQuerySchema = t.Object({
		name: t.String(),
		page: t.Number(),
		limit: t.Integer(),
		active: t.Boolean()
	})
	const reusedQueryApp = new Elysia()
	const reusedQueryPlanBefore = memorySnapshot()
	const reusedQueryPlanBeforeRss = process.memoryUsage().rss
	const reusedQueryRoutes = Array.from(
		{ length: validators },
		() =>
			new RouteValidator(
				{ query: reusedQuerySchema },
				{
					normalize: true,
					validationPlan: queryRoutePlan,
					app: reusedQueryApp
				}
			)
	)
	if (new Set(reusedQueryRoutes.map((route) => route.query)).size !== 1)
		throw new Error(
			'reused-schema fixture did not reuse its query validator'
		)
	const reusedFusedPlans = reusedQueryRoutes
		.map((route) => route.queryPlan)
		.filter((plan) => plan?.fused)
	if (
		(validationLane === 'candidate' &&
			(reusedFusedPlans.length !== validators ||
				new Set(reusedFusedPlans).size !== 1)) ||
		(validationLane !== 'candidate' && reusedFusedPlans.length !== 0)
	)
		throw new Error('reused-schema fixture selected the wrong query plan')
	gc()
	const reusedQueryPlanAfter = memorySnapshot()
	const reusedQueryPlanAfterRss = process.memoryUsage().rss
	reusedQueryRoutes.length = 0
	Validator.clear()
	gc()

	const retainedBodySchemas = Array.from({ length: validators }, (_, index) =>
		t.Object({
			user: t.Object({
				name: t.String(),
				age: t.Number({ minimum: -index - 1 })
			}),
			tags: t.Array(t.String())
		})
	)
	const bodyBefore = memorySnapshot()
	const bodyBeforeRss = process.memoryUsage().rss
	const bodyBeforeExecutables = executableSnapshot(jsc)
	const retainedBodyValidators: any[] = []
	let retainedBodySink = 0
	for (let i = 0; i < validators; i++) {
		const validator = new RouteValidator(
			{ body: retainedBodySchemas[i] },
			validationOptions
		).body as any
		retainedBodyValidators.push(validator)
		retainedBodySink += validator.FromSync(bodyInput, 'body').user.age
	}
	if (new Set(retainedBodyValidators).size !== validators)
		throw new Error(
			'retained body validator fixture hit the structural cache'
		)
	gc()
	const bodyAfter = memorySnapshot()
	const bodyAfterRss = process.memoryUsage().rss
	const bodyAfterExecutables = executableSnapshot(jsc)
	if (retainedBodySink !== validators * 7)
		throw new Error('retained body validators produced the wrong result')

	let rejectedBodies = 0
	for (const validator of retainedBodyValidators)
		try {
			validator.FromSync(
				{ user: { name: 'elysia', age: 'bad' }, tags: [] },
				'body'
			)
		} catch (error: any) {
			rejectedBodies++
			void error.errors
		}
	if (rejectedBodies !== validators)
		throw new Error(
			'retained body validators did not all reject invalid input'
		)
	gc()
	const bodyAfterErrors = memorySnapshot()
	const bodyAfterErrorExecutables = executableSnapshot(jsc)

	const checksum =
		scalarResult.page +
		objectStringResult.filter.take +
		arrayStringResult.ids[3] +
		bodyResult.user.age +
		constructionResult.page +
		bodyConstructionResult.user.age +
		invalidQueryTiming.last +
		queryErrorChecksum +
		inferenceSink +
		retainedSink +
		retainedBodySink

	console.log(
		JSON.stringify({
			fixture: 'validation',
			validationLane,
			implementations,
			shapeImplementations,
			warmup,
			requests,
			validators,
			batch,
			routeBatch,
			checksum,
			queryErrorChecksum,
			samples: {
				'route-scalar-query-p50-ns': routeQueryTiming,
				'route-repeated-query-p50-ns': repeatedRouteQueryTiming,
				'route-invalid-query-p50-ns': invalidRouteQueryTiming,
				'query-plan-construction-p50-ns':
					queryPlanConstructionSamples,
				'scalar-query-p50-ns': scalarTiming.samples,
				'invalid-query-p50-ns': invalidQueryTiming.samples,
				'object-string-p50-ns': objectStringTiming.samples,
				'array-string-p50-ns': arrayStringTiming.samples,
				'json-body-p50-ns': bodyTiming.samples,
				'validator-construction-p50-ns': constructionSamples,
				'json-body-validator-construction-p50-ns':
					bodyConstructionSamples,
				'json-body-construction-highwater-current-bytes-per-validator':
					[
						(bodyConstructionHighwaterCurrent -
							bodyConstructionBeforeCurrent) /
							(warmup + requests)
					],
				'pathological-inference-p50-ns': inferenceSamples,
				'construction-highwater-current-bytes-per-validator': [
					(highwaterCurrent - before.current) / validators
				],
				'retained-current-bytes-per-validator': [
					(after.current - before.current) / validators
				],
				'retained-heap-size-bytes-per-validator': [
					((after.heapSize ?? 0) - (before.heapSize ?? 0)) /
						validators
				],
				'retained-extra-memory-bytes-per-validator': [
					((after.extraMemorySize ?? 0) -
						(before.extraMemorySize ?? 0)) /
						validators
				],
				'retained-rss-bytes-per-validator': [
					(afterRss - beforeRss) / validators
				],
				'query-post-error-retained-current-bytes-per-validator': [
					(afterQueryErrors.current - after.current) / validators
				],
				'query-post-error-retained-heap-size-bytes-per-validator': [
					((afterQueryErrors.heapSize ?? 0) - (after.heapSize ?? 0)) /
						validators
				],
				'query-post-error-retained-extra-memory-bytes-per-validator': [
					((afterQueryErrors.extraMemorySize ?? 0) -
						(after.extraMemorySize ?? 0)) /
						validators
				],
				'query-post-error-retained-rss-bytes-per-validator': [
					(afterQueryErrorRss - afterRss) / validators
				],
				'query-post-error-function-executables-per-validator': [
					(afterQueryErrorExecutables.functionExecutable -
						afterExecutables.functionExecutable) /
						validators
				],
				'query-post-error-function-code-blocks-per-validator': [
					(afterQueryErrorExecutables.functionCodeBlock -
						afterExecutables.functionCodeBlock) /
						validators
				],
				'query-post-error-unlinked-function-executables-per-validator':
					[
						(afterQueryErrorExecutables.unlinkedFunctionExecutable -
							afterExecutables.unlinkedFunctionExecutable) /
							validators
					],
				'query-plan-retained-current-bytes-per-validator': [
					(queryPlanAfter.current - queryPlanBefore.current) /
						validators
				],
				'query-plan-retained-heap-size-bytes-per-validator': [
					((queryPlanAfter.heapSize ?? 0) -
						(queryPlanBefore.heapSize ?? 0)) /
						validators
				],
				'query-plan-retained-extra-memory-bytes-per-validator': [
					((queryPlanAfter.extraMemorySize ?? 0) -
						(queryPlanBefore.extraMemorySize ?? 0)) /
						validators
				],
				'query-plan-retained-rss-bytes-per-validator': [
					(queryPlanAfterRss - queryPlanBeforeRss) / validators
				],
				'query-plan-post-error-retained-current-bytes-per-validator': [
					(queryPlanAfterErrors.current - queryPlanAfter.current) /
						validators
				],
				'query-plan-post-error-retained-heap-size-bytes-per-validator':
					[
						((queryPlanAfterErrors.heapSize ?? 0) -
							(queryPlanAfter.heapSize ?? 0)) /
							validators
					],
				'query-plan-post-error-retained-extra-memory-bytes-per-validator':
					[
						((queryPlanAfterErrors.extraMemorySize ?? 0) -
							(queryPlanAfter.extraMemorySize ?? 0)) /
							validators
					],
				'reused-query-plan-retained-current-bytes-per-validator': [
					(reusedQueryPlanAfter.current -
						reusedQueryPlanBefore.current) /
						validators
				],
				'reused-query-plan-retained-heap-size-bytes-per-validator': [
					((reusedQueryPlanAfter.heapSize ?? 0) -
						(reusedQueryPlanBefore.heapSize ?? 0)) /
						validators
				],
				'reused-query-plan-retained-extra-memory-bytes-per-validator': [
					((reusedQueryPlanAfter.extraMemorySize ?? 0) -
						(reusedQueryPlanBefore.extraMemorySize ?? 0)) /
						validators
				],
				'reused-query-plan-retained-rss-bytes-per-validator': [
					(reusedQueryPlanAfterRss - reusedQueryPlanBeforeRss) /
						validators
				],
				'json-body-retained-current-bytes-per-validator': [
					(bodyAfter.current - bodyBefore.current) / validators
				],
				'json-body-retained-heap-size-bytes-per-validator': [
					((bodyAfter.heapSize ?? 0) - (bodyBefore.heapSize ?? 0)) /
						validators
				],
				'json-body-retained-extra-memory-bytes-per-validator': [
					((bodyAfter.extraMemorySize ?? 0) -
						(bodyBefore.extraMemorySize ?? 0)) /
						validators
				],
				'json-body-retained-rss-bytes-per-validator': [
					(bodyAfterRss - bodyBeforeRss) / validators
				],
				'json-body-retained-function-executables-per-validator': [
					(bodyAfterExecutables.functionExecutable -
						bodyBeforeExecutables.functionExecutable) /
						validators
				],
				'json-body-retained-function-code-blocks-per-validator': [
					(bodyAfterExecutables.functionCodeBlock -
						bodyBeforeExecutables.functionCodeBlock) /
						validators
				],
				'json-body-retained-unlinked-function-executables-per-validator':
					[
						(bodyAfterExecutables.unlinkedFunctionExecutable -
							bodyBeforeExecutables.unlinkedFunctionExecutable) /
							validators
					],
				'json-body-post-error-retained-current-bytes-per-validator': [
					(bodyAfterErrors.current - bodyAfter.current) / validators
				],
				'json-body-post-error-retained-heap-size-bytes-per-validator': [
					((bodyAfterErrors.heapSize ?? 0) -
						(bodyAfter.heapSize ?? 0)) /
						validators
				],
				'json-body-post-error-retained-extra-memory-bytes-per-validator':
					[
						((bodyAfterErrors.extraMemorySize ?? 0) -
							(bodyAfter.extraMemorySize ?? 0)) /
							validators
					],
				'json-body-post-error-function-executables-per-validator': [
					(bodyAfterErrorExecutables.functionExecutable -
						bodyAfterExecutables.functionExecutable) /
						validators
				],
				'json-body-post-error-function-code-blocks-per-validator': [
					(bodyAfterErrorExecutables.functionCodeBlock -
						bodyAfterExecutables.functionCodeBlock) /
						validators
				],
				'json-body-post-error-unlinked-function-executables-per-validator':
					[
						(bodyAfterErrorExecutables.unlinkedFunctionExecutable -
							bodyAfterExecutables.unlinkedFunctionExecutable) /
							validators
					]
			}
		})
	)

	void retainedSchemas
	void retainedValidators
	void retainedBodySchemas
	void retainedBodyValidators
}

try {
	await main()
} catch (error) {
	console.error(error)
	process.exitCode = 1
}
