import { Elysia, t } from '../src'

import { describe, expect, it } from 'bun:test'
import { post, req } from './utils'

describe('guard', () => {
  it('inherits global', async () => {
    const app = new Elysia().state('counter', 0).guard(
      {
        transform: ({ store }) => {
          store.counter++
        }
      },
      (app) =>
        app.get('/', ({ store: { counter } }) => counter, {
          transform: ({ store }) => {
            store.counter++
          }
        })
    )

    const valid = await app.handle(req('/'))

    expect(await valid.text()).toBe('2')
  })

  it('delegate onRequest', async () => {
    const app = new Elysia()
      .get('/', () => 'A')
      .guard({}, (app) =>
        app
          .state('counter', 0)
          .onRequest(({ store }) => {
            store.counter++
          })
          .get('/counter', ({ store: { counter } }) => counter)
      )

    await app.handle(req('/'))
    const res = await app.handle(req('/counter')).then((r) => r.text())

    expect(res).toBe('2')
  })

  it('decorate guard', async () => {
    const app = new Elysia().guard({}, (app) =>
      app.decorate('a', 'b').get('/', ({ a }) => a)
    )

    const res = await app.handle(req('/')).then((x) => x.text())

    expect(res).toBe('b')
  })

  it('validate headers', async () => {
    const app = new Elysia().guard(
      {
        headers: t.Object({
          authorization: t.String()
        })
      },
      (app) => app.get('/', () => 'Hello')
    )

    const error = await app.handle(req('/'))
    const correct = await app.handle(
      new Request('http://localhost/', {
        headers: {
          authorization: 'Bearer'
        }
      })
    )

    expect(correct.status).toBe(200)
    expect(error.status).toBe(400)
  })

  it('validate params', async () => {
    const app = new Elysia().guard(
      {
        transform({ params }) {
          if (!+Number.isNaN(params.id)) params.id = +params.id
        },
        params: t.Object({
          id: t.Number()
        })
      },
      (app) => app.get('/id/:id', () => 'Hello')
    )

    const error = await app.handle(req('/id/a'))
    const correct = await app.handle(req('/id/1'))

    expect(correct.status).toBe(200)
    expect(error.status).toBe(400)
  })

  it('validate query', async () => {
    const app = new Elysia().guard(
      {
        query: t.Object({
          name: t.String()
        })
      },
      (app) => app.get('/', () => 'Hello')
    )

    const error = await app.handle(req('/?id=1'))
    const correct = await app.handle(req('/?name=a'))

    expect(correct.status).toBe(200)
    expect(error.status).toBe(400)
  })

  it('validate body', async () => {
    const app = new Elysia().guard(
      {
        body: t.Object({
          name: t.String()
        })
      },
      (app) => app.post('/', ({ body }) => body)
    )

    const error = await app.handle(
      post('/', {
        id: 'hi'
      })
    )
    const correct = await app.handle(
      post('/', {
        name: 'hi'
      })
    )

    expect(correct.status).toBe(200)
    expect(error.status).toBe(400)
  })

  it('validate response', async () => {
    const app = new Elysia().guard(
      {
        response: t.String()
      },
      (app) =>
        app
          .get('/correct', () => 'Hello')
          // @ts-ignore
          .get('/error', () => 1)
    )

    const error = await app.handle(req('/error'))
    const correct = await app.handle(req('/correct'))

    expect(correct.status).toBe(200)
    expect(error.status).toBe(400)
  })
})
