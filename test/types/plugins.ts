import { Elysia, t } from '../../src'

const plugin = async (app: Elysia) =>
	app.decorate('decorate', 'a').state('state', 'a').model({
		string: t.String()
	})

export default plugin
