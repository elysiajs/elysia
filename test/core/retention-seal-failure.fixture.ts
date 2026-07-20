// @ts-nocheck -- exercises intentionally private seal state in production.
process.env.NODE_ENV = 'production'

const { Elysia, t } = await import('../../src')

let served = 0
const bodies: unknown[] = []
const app = new Elysia({ normalize: 'typebox' }).post(
	'/',
	{ body: t.Object({ route: t.String() }) },
	({ body }) => {
		served++
		bodies.push(body)
		return 'served'
	}
)

const errors: string[] = []
for (let i = 0; i < 2; i++)
	try {
		void app.fetch
	} catch (error) {
		errors.push((error as Error).message)
	}

for (let i = 0; i < 2; i++)
	try {
		await app.handle(
			new Request('http://e.ly/', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ route: 'yes', guard: 'yes' })
			})
		)
	} catch (error) {
		errors.push((error as Error).message)
	}

console.log(
	JSON.stringify({
		errors,
		served,
		bodies,
		generation: app['~generation'] !== undefined
	})
)
