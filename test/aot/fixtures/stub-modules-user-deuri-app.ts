import decode from 'deuri'
import { Elysia } from '../../../src'

// User code importing deuri itself keeps the real decoder while Elysia's
// routes are static, so only the fetch handler's import gets the stub
export const app = new Elysia().get('/', decode('a%20b'))
