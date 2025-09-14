import { Elysia, t } from '../src'
import z from 'zod'
import { req } from '../test/utils'

const app = new Elysia()
	.macro('guestOrUser', {
		resolve: () => {
			return {
				user: null
			}
		}
	})
	.macro('user', {
		guestOrUser: true,
		body: t.String(),
		resolve: ({ body, status, user }) => {}
	})
