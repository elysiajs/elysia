import { Elysia, t } from '../src'

export const app = new Elysia()
	// Group with `id` param
	.group('/services/:id', { params: t.Object({ id: t.Number() }) }, (app) =>
		app
			.resolve(({ params: { id } }) => ({
				service: { name: `Service ${id}` }
			}))
			.get(
				'/details',
				({ service }) => `Hello from service ${service.name}`
			)
			// Schema for this route repeats the `id` param - works ✅
			.post(
				'/smooth/:signal',
				({ service, params: { signal } }) =>
					`Hello from service ${service.name} signal: ${signal}`,
				{ params: t.Object({ signal: t.String(), id: t.Number() }) }
			)
			// Schema for this route doesn't repeat the `id` param - gives HTTP 422 ⚠️
			.post(
				'/trouble/:signal',
				({ service, params: { signal } }) =>
					`Hello from service ${service.name} signal: ${signal}`,
				{ params: t.Object({ signal: t.String() }) }
			)
	)

for (const [verb, url] of [
	['GET', 'http://localhost:3000/services/1/details'],
	['POST', 'http://localhost:3000/services/1/smooth/A'],
	['POST', 'http://localhost:3000/services/1/trouble/A']
]) {
	const res = await app.handle(new Request(url, { method: verb }))
	console.log(`${verb} ${url} → ${res.status}: ${await res.text()}`)
}
