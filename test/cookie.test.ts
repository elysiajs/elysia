import { describe, it, expect } from 'bun:test'
import { Elysia } from '../src'
import { req } from './utils'

const app = new Elysia()
  .get('/single', ({ set }) => {
    set.headers = {
      'Set-Cookie': 'a=b'
    }
  })
  .get('/multiple', ({ set }) => {
    set.headers = {
      // @ts-ignore
      'Set-Cookie': ['a=b', 'c=d']
    }

    return 'a'
  })

describe('cookie', () => {
  it('set single cookie', async () => {
    const res = await app
      .handle(req('/single'))
      .then((r) => r.headers.getAll('Set-Cookie'))

    expect(res).toEqual(['a=b'])
  })

  it('set multiple cookie', async () => {
    const res = await app
      .handle(req('/multiple'))
      .then((r) => r.headers.getAll('Set-Cookie'))

    expect(res).toEqual(['a=b', 'c=d'])
  })
})
