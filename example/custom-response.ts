import { KingWorld } from '../src'

// This plugin will format JSON before return response
const prettyJson = (app: KingWorld) =>
	// Custom
	app.onAfterHandle((response, context) => {
		if (response instanceof Object)
			try {
				return JSON.stringify(response, null, 4)
			} catch (error) {
				return
			}
	})

new KingWorld()
	.use(prettyJson)
	.get('/', () => ({
		hello: 'world'
	}))
	.listen(8080)
