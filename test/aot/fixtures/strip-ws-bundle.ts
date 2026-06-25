import { Elysia } from '../../../src'

export default new Elysia().ws('/ws', { message: () => {} })
