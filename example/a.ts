import { Elysia } from '../src'

const app = new Elysia().get('/', function* ({ status }) {
	const project = { url: '1234' }
	if (!project) return status(400)
	return status(200, project.url)
})

app['~Routes'].get.response
