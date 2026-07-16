// A fresh process sets NODE_ENV before the compiled error pipeline is created.
import { Elysia } from '../../src'

const get = () => new Request('http://localhost/')

const throwing = (mut: (e: any) => void) =>
	new Elysia()
		.error(() => {})
		.get('/', () => {
			const e: any = new Error('secret: db password is hunter2')
			mut(e)
			throw e
		})

class ThrowingToResponse extends Error {
	status = 503
	constructor() {
		super('original 503 message')
		this.name = 'ThrowingToResponse'
	}
	toResponse(): Response {
		throw new Error('INNER-THROW-LEAK')
	}
}

const compiledThrow = () =>
	new Elysia()
		.error(() => {})
		.get('/', () => {
			throw new ThrowingToResponse()
		})
		.handle(get())

const interpretedThrow = () =>
	new Elysia()
		.get('/', () => {
			throw new ThrowingToResponse()
		})
		.handle(get())

const scenarios: Record<string, () => Promise<Response>> = {
	fiveHundred: () => throwing((e) => (e.status = 500)).handle(get()),

	explicitResponse: () =>
		throwing((e) => {
			e.status = 500
			e.response = 'explicit body'
		}).handle(get()),

	fourHundred: () => throwing((e) => (e.status = 400)).handle(get()),

	fiveOhThree: () => throwing((e) => (e.status = 503)).handle(get()),

	syncThrowCompiled: compiledThrow,
	syncThrowInterpreted: interpretedThrow
}

const out: Record<string, { status: number; body: string }> = {}
for (const key in scenarios) {
	const res = await scenarios[key]!()
	out[key] = { status: res.status, body: await res.text() }
}

console.log(JSON.stringify(out))
