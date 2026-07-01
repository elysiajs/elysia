import { Elysia } from "../src";

const app = new Elysia()
	.trace('global', ({ onHandle }) => {
		onHandle(({ name }) => {
			console.log(name) // should be 'a' not 'handle'
		})
	})
	.get('/', function a() {
		return 'ok'
	})

app.handle('/')
