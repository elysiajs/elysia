import { Elysia, t } from '../src'

declare module 'elysia' {
	interface ElysiaInstance extends RawElysiaInstance {
		store: {
			counter: 0
			anything: {
				alright: 'done'
			}
		}
		decorate: {
			hello: 'world'
			log(a: string): void
		}
		model: {
			sign: {
				username: string
				password: string
			}
		}
	}
}

// setup.ts
const setup = new Elysia({ name: 'setup' })
	.state({
		container: {
			counter: 0,
			anything: {
				alright: 'done'
			}
		}
	})
	.decorate({
		hello: 'world',
		log(a: string) {
			console.log(a)
		}
	})
	.model({
		sign: t.Object({
			username: t.String(),
			password: t.String()
		})
	})

// index.ts
const main = new Elysia().use(setup).get('/', ({ log }) => {
	log('A')

	return 'hi'
})

// another.ts
const another = new Elysia()
	.use(setup)
	.post('/', ({ store: { container } }) => container.counter++, {
		body: 'sign'
	})
