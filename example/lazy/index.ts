import Elysia from '../../src'

export const lazy = (app: Elysia) =>
	app.state('a', 'b').get('/lazy', 'Hi from lazy loaded module')

export default lazy
