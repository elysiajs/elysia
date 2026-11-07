import { Memoirist } from 'memoirist'
import { Elysia } from '../../../src'

// User code importing memoirist itself keeps the real router while Elysia's
// own routes are static, so Elysia's import alone gets the stub
const lookup = new Memoirist<string>()
lookup.add('GET', '/id/:id', 'found')

export const app = new Elysia().get('/', lookup.find('GET', '/id/42')!.store)
