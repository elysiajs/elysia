import Elysia from '../../src'

export const lazy = (app: Elysia) => app.get('/lazy', () => 'Hi')

export default lazy
