import { Elysia, t } from '../src'
import { req } from '../test/utils'

const a = new Elysia({ name: 'a' }).macro(({ onBeforeHandle }) => {
	return {
		isSignIn() {
			console.log('RE')
			onBeforeHandle(() => {
				console.log('EX')
			})
		}
	}
})

const b = new Elysia({ name: 'b' }).use(a)

const c = new Elysia().use(b).get(
	'/',
	() => {
		return 'ok'
	},
	{
		isSignIn: true
	}
)

const app = new Elysia().use(c)

app.handle(req('/'))

// const api = treaty(a)

// const { data, error, response } = await api.error.get()

// console.log(data, error, response)
