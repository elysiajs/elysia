import { Elysia } from '../src'

const barService = new Elysia().use(async (app) => {
	const bar = await Promise.resolve(10)

	return app.decorate('barService', bar)
})

const fooService = new Elysia().use(barService).decorate((d) => {
	console.log(d.barService)

	return d
})

const app = new Elysia().use(fooService).listen(3000)

console.log(
	`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
)
