import { Elysia, MaybeArray, status, t } from '../src'
import z from 'zod'

const app = new Elysia()
	.macro({
		q: {
			beforeHandle: [
				({ status }) => {
					if (Math.random() > 0.05) return status(401)
				},
				({ status }) => {
					if (Math.random() > 0.05) return status(402)
				}
			]
		}
	})
	.guard({
		q: true
	})
	.get('/', () => {}, {
	})

type A = (typeof app)['~Volatile']['standaloneSchema']
type B = (typeof app)['~Routes']['get']['response']
