import { Elysia } from '../../../src'
import { trace } from '../../../src/plugin/trace'

// The trace capability is registered but no `.trace()` handler exists, so the trace runtime is stripped.
export const app = new Elysia().use(trace()).get('/', 'hi')
