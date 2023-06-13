import { describe, it, expect } from 'bun:test'
import { Elysia } from '../src'
import { req, post } from './utils'

describe('code generation', () => {
  it('process body', async () => {
    const body = { hello: 'Wanderschaffen' }

    const app = new Elysia()
      .post('/1', ({ body }) => body)
      .post('/2', function ({ body }) {
        return body
      })
      .post('/3', (context) => {
        return context.body
      })
      .post('/4', (context) => {
        const c = context
        const { body } = c

        return body
      })
      .post('/5', (context) => {
        const _ = context,
          a = context
        const { body } = a

        return body
      })
      .post('/6', () => body, {
        transform({ body }) {
          // not empty
        }
      })
      .post('/7', () => body, {
        beforeHandle({ body }) {
          // not empty
        }
      })
      .post('/8', () => body, {
        afterHandle({ body }) {
          // not empty
        }
      })

    const from = (number: number) =>
      app.handle(post(`/${number}`, body)).then((r) => r.json())

    expect(await from(1)).toEqual(body)
    expect(await from(2)).toEqual(body)
    expect(await from(3)).toEqual(body)
    expect(await from(4)).toEqual(body)
    expect(await from(5)).toEqual(body)
    expect(await from(6)).toEqual(body)
    expect(await from(7)).toEqual(body)
    expect(await from(8)).toEqual(body)
  })
})
