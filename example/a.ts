import { Elysia, status, t } from '../src'

status(401)

const app = new Elysia()
	.macro({
		multiple: {
			resolve({ status }) {
				if (Math.random() > 0.5) return status(401)
				return status(403)
			}
		}
	})
	.get('/multiple', () => 'Ok', { multiple: true })

app['~Routes']['multiple']['get']['response']
