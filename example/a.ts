import { Elysia, t } from '../src'

const plugin = new Elysia()
	.derive(() => ({
		pluginMethod() {
			console.log('pluginMethod')
		}
	}))
	.derive(({ pluginMethod, ...rest }) => ({
		myPluginMethod: pluginMethod,
		...rest
	}))
	.as('plugin')

const app = new Elysia().use(plugin).get('/', (ctx) => {
	ctx.myPluginMethod()
})
