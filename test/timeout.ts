import { Elysia } from '../src'

const largePlugin = async (app: Elysia) => {
	await new Promise((resolve) => setTimeout(resolve, 1000))

	return app.get('/large', () => 'Hi')
}

export default largePlugin
