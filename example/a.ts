import { Elysia, t } from '../src'
import { UnwrapTypeModule } from '../src/types'

const app = new Elysia()
	.macro({
		a() {
			return {
				resolve() {
					return {
						a: 'a'
					}
				}
			}
		}
	})
	.get('/', ({ a }) => {

	}, {
		a: undefined
	})

const p = new Elysia().model({
	salt: t.Object({
		username: t.String(),
		password: t.String()
	})
})
