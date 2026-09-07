// TypeBox load state is process-wide, so each arm runs separately.
import { type } from 'arktype'
import * as v from 'valibot'
import { z } from 'zod'

import { Elysia, t } from '../../src'
import * as typeboxValue from '../../src/type/typebox-value'

// `Check` changes when TypeBox loads.
const coldCheck = typeboxValue.Check
const isTypeboxLoaded = () => typeboxValue.Check !== coldCheck

const arm = process.argv[2]

// Snapshot this before a request can load TypeBox.
let loadedAtBuild = false

const build = (app: Elysia<any, any, any, any, any, any, any, any>) => {
	// `listen()` reads `fetch` to build the router.
	void app.fetch
	loadedAtBuild = isTypeboxLoaded()
}

// Confirm whether a guard reaches the route before checking warm-up.
const assertBodyGuarded = async (app: any, guarded: boolean) => {
	const response = await app.handle(
		new Request('http://localhost/', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ nope: 1 })
		})
	)

	if ((response.status === 422) !== guarded)
		throw new Error(
			`expected the guard to be ${guarded ? '' : 'in'}active, got ${response.status}`
		)
}

switch (arm) {
	case 'loaded:none': {
		build(
			new Elysia().get('/', () => 'ok').post('/echo', ({ body }) => body)
		)
		break
	}

	// Cover callable and object Standard Schema implementations.
	case 'loaded:standard': {
		build(
			new Elysia()
				.model({ sign: z.object({ a: z.string() }) })
				.post(
					'/',
					{ body: type({ name: 'string' }) },
					({ body }) => body
				)
				.post(
					'/z',
					{ body: z.object({ name: z.string() }) },
					() => 'ok'
				)
				.post(
					'/v',
					{ body: v.object({ name: v.string() }) },
					() => 'ok'
				)
				.post('/m', { body: 'sign' }, () => 'ok')
				.get(
					'/q',
					{
						query: type({ q: 'string' }),
						response: { 200: z.string() }
					},
					() => 'ok'
				)
		)
		break
	}

	case 'loaded:typebox': {
		build(
			new Elysia().post(
				'/',
				{ body: t.Object({ name: t.String() }) },
				({ body }) => body
			)
		)
		break
	}

	case 'loaded:guard': {
		build(
			new Elysia()
				.guard({ query: t.Object({ q: t.String() }) })
				.get('/', () => 'ok')
		)
		break
	}

	// The plugin guard is reachable only through the route chain.
	case 'loaded:plugin-guard': {
		build(
			new Elysia().use(
				new Elysia({ name: 'p' })
					.guard({ query: t.Object({ q: t.String() }) })
					.get('/p', () => 'ok')
			)
		)
		break
	}

	// A root guard added after `.use()` is reachable only through the root chain.
	case 'loaded:root-chain': {
		build(
			new Elysia()
				.use(new Elysia({ name: 'p' }).get('/p', () => 'ok'))
				.guard({ query: t.Object({ q: t.String() }) })
		)
		break
	}

	case 'loaded:model-ref': {
		build(
			new Elysia()
				.model({ sign: t.Object({ a: t.String() }) })
				.post('/', { body: 'sign' }, () => 'ok')
		)
		break
	}

	case 'loaded:response-record': {
		build(
			new Elysia().get('/', { response: { 200: t.String() } }, () => 'ok')
		)
		break
	}

	case 'loaded:macro': {
		build(
			new Elysia()
				.macro({ auth: () => ({ body: t.Object({ a: t.String() }) }) })
				.post('/', { auth: true }, () => 'ok')
		)
		break
	}

	// A guard macro is reachable only through chain resolution.
	case 'loaded:chain-macro': {
		const app = new Elysia()
			.macro({ auth: () => ({ body: t.Object({ a: t.String() }) }) })
			.guard({ auth: true })
			.post('/', ({ body }) => body)

		build(app)
		await assertBodyGuarded(app, true)
		break
	}

	// A guard added after a route must not warm that route.
	case 'loaded:late-root-guard': {
		const app = new Elysia()
			.post('/', ({ body }) => body)
			.guard({ body: t.Object({ a: t.String() }) })

		build(app)
		await assertBodyGuarded(app, false)
		break
	}

	case 'lag': {
		const app = new Elysia()
			.post(
				'/',
				{ body: t.Object({ name: t.String() }) },
				({ body }) => body
			)
			.listen(0)

		const port = app.server!.port

		let maxLag = 0
		let last = Bun.nanoseconds()
		const timer = setInterval(() => {
			const now = Bun.nanoseconds()
			const lag = (now - last) / 1e6 - 5
			if (lag > maxLag) maxLag = lag
			last = now
		}, 5)

		const perRequest: number[] = []

		// Exclude the interval's first tick.
		await Bun.sleep(30)
		maxLag = 0
		last = Bun.nanoseconds()

		for (let i = 0; i < 5; i++) {
			const started = Bun.nanoseconds()
			const response = await fetch(`http://localhost:${port}/`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name: 'elysia' })
			})
			await response.text()
			perRequest.push((Bun.nanoseconds() - started) / 1e6)

			if (response.status !== 200)
				throw new Error(`request ${i + 1} answered ${response.status}`)
		}

		clearInterval(timer)
		await app.stop()

		console.log(JSON.stringify({ maxLag, perRequest }))
		break
	}

	default:
		throw new Error(`unknown arm ${arm}`)
}

if (arm.startsWith('loaded:'))
	console.log(JSON.stringify({ loaded: loadedAtBuild }))
