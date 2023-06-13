import { Elysia } from '../src'

import { describe, expect, it } from 'bun:test'
import { req } from './utils'

describe('Resposne Headers', () => {
  it('add response headers', async () => {
    const app = new Elysia().get('/', ({ set }) => {
      set.headers['x-powered-by'] = 'Elysia'

      return 'Hi'
    })
    const res = await app.handle(req('/'))

    expect(res.headers.get('x-powered-by')).toBe('Elysia')
  })

  it('add headers from hook', async () => {
    const app = new Elysia()
      .onTransform(({ set }) => {
        set.headers['x-powered-by'] = 'Elysia'
      })
      .get('/', () => 'Hi')
    const res = await app.handle(req('/'))

    expect(res.headers.get('x-powered-by')).toBe('Elysia')
  })

  it('add headers from plugin', async () => {
    const plugin = (app: Elysia) =>
      app.onTransform(({ set }) => {
        set.headers['x-powered-by'] = 'Elysia'
      })

    const app = new Elysia().use(plugin).get('/', () => 'Hi')
    const res = await app.handle(req('/'))

    expect(res.headers.get('x-powered-by')).toBe('Elysia')
  })

  it('add headers to Response', async () => {
    const app = new Elysia()
      .onTransform(({ set }) => {
        set.headers['x-powered-by'] = 'Elysia'
      })
      .get('/', () => new Response('Hi'))
    const res = await app.handle(req('/'))

    expect(res.headers.get('x-powered-by')).toBe('Elysia')
  })

  it('add status to Response', async () => {
    const app = new Elysia().get('/', ({ set }) => {
      set.status = 401

      return 'Hi'
    })

    const res = await app.handle(req('/'))

    expect(await res.text()).toBe('Hi')
    expect(res.status).toBe(401)
  })
})
