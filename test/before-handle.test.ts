import { Elysia } from '../src'

import { describe, expect, it } from 'bun:test'
import { req } from './utils'

describe('Before Handle', () => {
  it('Globally skip main handler', async () => {
    const app = new Elysia()
      .onBeforeHandle<{
        params: {
          name?: string
        }
      }>(({ params: { name } }) => {
        if (name === 'Fubuki') return 'Cat'
      })
      .get('/name/:name', ({ params: { name } }) => name)

    const res = await app.handle(req('/name/Fubuki'))

    expect(await res.text()).toBe('Cat')
  })

  it('Locally skip main handler', async () => {
    const app = new Elysia().get(
      '/name/:name',
      ({ params: { name } }) => name,
      {
        beforeHandle: ({ params: { name } }) => {
          if (name === 'Fubuki') return 'Cat'
        }
      }
    )

    const res = await app.handle(req('/name/Fubuki'))

    expect(await res.text()).toBe('Cat')
  })

  it('Group before handler', async () => {
    const app = new Elysia()
      .group('/type', (app) =>
        app
          .onBeforeHandle<{
            params: {
              name?: string
            }
          }>(({ params: { name } }) => {
            if (name === 'fubuki') return 'cat'
          })
          .get('/name/:name', ({ params: { name } }) => name)
      )
      .get('/name/:name', ({ params: { name } }) => name)

    const base = await app.handle(req('/name/fubuki'))
    const scoped = await app.handle(req('/type/name/fubuki'))

    expect(await base.text()).toBe('fubuki')
    expect(await scoped.text()).toBe('cat')
  })

  it('before handle from plugin', async () => {
    const transformId = (app: Elysia) =>
      app.onBeforeHandle<{
        params: {
          name?: string
        }
      }>(({ params: { name } }) => {
        if (name === 'Fubuki') return 'Cat'
      })

    const app = new Elysia()
      .use(transformId)
      .get('/name/:name', ({ params: { name } }) => name)

    const res = await app.handle(req('/name/Fubuki'))

    expect(await res.text()).toBe('Cat')
  })

  it('Before handle in order', async () => {
    const app = new Elysia()
      .get('/name/:name', ({ params: { name } }) => name)
      .onBeforeHandle<{
        params: {
          name?: string
        }
      }>(({ params: { name } }) => {
        if (name === 'fubuki') return 'cat'
      })

    const res = await app.handle(req('/name/fubuki'))

    expect(await res.text()).toBe('fubuki')
  })

  it('Globally and locally before handle', async () => {
    const app = new Elysia()
      .onBeforeHandle<{
        params: {
          name?: string
        }
      }>(({ params: { name } }) => {
        if (name === 'fubuki') return 'cat'
      })
      .get('/name/:name', ({ params: { name } }) => name, {
        beforeHandle: ({ params: { name } }) => {
          if (name === 'korone') return 'dog'
        }
      })

    const fubuki = await app.handle(req('/name/fubuki'))
    const korone = await app.handle(req('/name/korone'))

    expect(await fubuki.text()).toBe('cat')
    expect(await korone.text()).toBe('dog')
  })

  it('Accept multiple before handler', async () => {
    const app = new Elysia()
      .onBeforeHandle<{
        params: {
          name?: string
        }
      }>(({ params: { name } }) => {
        if (name === 'fubuki') return 'cat'
      })
      .onBeforeHandle<{
        params: {
          name?: string
        }
      }>(({ params: { name } }) => {
        if (name === 'korone') return 'dog'
      })
      .get('/name/:name', ({ params: { name } }) => name)

    const fubuki = await app.handle(req('/name/fubuki'))
    const korone = await app.handle(req('/name/korone'))

    expect(await fubuki.text()).toBe('cat')
    expect(await korone.text()).toBe('dog')
  })

  it('Handle async', async () => {
    const app = new Elysia().get(
      '/name/:name',
      ({ params: { name } }) => name,
      {
        beforeHandle: async ({ params: { name } }) => {
          await new Promise<void>((resolve) =>
            setTimeout(() => {
              resolve()
            }, 1)
          )

          if (name === 'Watame') return 'Warukunai yo ne'
        }
      }
    )

    const res = await app.handle(req('/name/Watame'))

    expect(await res.text()).toBe('Warukunai yo ne')
  })

  it("Handle on('beforeHandle')", async () => {
    const app = new Elysia()
      .on('beforeHandle', async ({ params: { name } }) => {
        await new Promise<void>((resolve) =>
          setTimeout(() => {
            resolve()
          }, 1)
        )

        if (name === 'Watame') return 'Warukunai yo ne'
      })
      .get('/name/:name', ({ params: { name } }) => name)

    const res = await app.handle(req('/name/Watame'))

    expect(await res.text()).toBe('Warukunai yo ne')
  })

  it('execute afterHandle', async () => {
    const app = new Elysia()
      .onBeforeHandle<{
        params: {
          name?: string
        }
      }>(({ params: { name } }) => {
        if (name === 'Fubuki') return 'Cat'
      })
      .onAfterHandle((context, response) => {
        if (response === 'Cat') return 'Not cat'
      })
      .get('/name/:name', ({ params: { name } }) => name)

    const res = await app.handle(req('/name/Fubuki'))

    expect(await res.text()).toBe('Not cat')
  })
})
