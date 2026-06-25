import { Elysia } from '../../../src'

export const app = new Elysia().ws('/ws', { message: () => {} })
