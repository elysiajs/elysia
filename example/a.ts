import { Elysia, MaybeArray, status, t } from '../src'
import z from 'zod'

const app = new Elysia()
	.macro({
		auth: {
			resolve({ status }) {
				if (Math.random() > 0.5) return status(401)

				return { user: 'saltyaom' } as const
			}
		}
	})
	.get('/', ({ headers, user }) => user, {
		auth: true,
		headers: t.Object({
			'x-api-key': t.String()
		})
	})

app['~Routes']['get']['response']
