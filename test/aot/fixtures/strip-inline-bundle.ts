import { Elysia } from '../../../src'

export default new Elysia().get('/', () => 'ok')
