import { Elysia } from '../../../src'
import { aot } from '../../../src/plugin/aot/bun'

// Schema-free, so the snapshot stub applies, while the bundle keeps the AOT
// plugin, which imports from the stubbed module
export { aot }

export const app = new Elysia().get('/', 'ok')
