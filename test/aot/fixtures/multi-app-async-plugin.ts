import { Elysia } from '../../../src'

// An empty plugin loaded through `.use(import(...))`, so its user settles async
export default new Elysia({ name: 'async-plugin' })
