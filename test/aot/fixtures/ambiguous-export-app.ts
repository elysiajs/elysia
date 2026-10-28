import { Elysia } from '../../../src'

// Own fixture — two Elysia instances, neither exported as `app` or `default`,
// so the AOT entry lookup cannot know which one to compile.
export const a = new Elysia().get('/a', () => 'a')
export const b = new Elysia().get('/b', () => 'b')
