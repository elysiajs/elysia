import { Elysia } from '../src'

import { describe, expect, it } from 'bun:test'
import { req } from './utils'

describe('derive', () => {
  it('work', async () => {
    const app = new Elysia()
      .derive(() => ({
        hi: () => 'hi'
      }))
      .get('/', ({ hi }) => hi())

    const res = await app.handle(req('/')).then((t) => t.text())
    expect(res).toBe('hi')
  })

  it('inherits plugin', async () => {
    const plugin = () => (app: Elysia) =>
      app.derive(() => ({
        hi: () => 'hi'
      }))

    const app = new Elysia().use(plugin()).get('/', ({ hi }) => hi())

    const res = await app.handle(req('/')).then((t) => t.text())
    expect(res).toBe('hi')
  })

  it('can mutate store', async () => {
    const app = new Elysia()
      .state('counter', 1)
      .derive(({ store }) => ({
        increase: () => store.counter++
      }))
      .get('/', ({ store, increase }) => {
        increase()

        return store.counter
      })

    const res = await app.handle(req('/')).then((t) => t.text())
    expect(res).toBe('2')
  })

  it('derive with static analysis', async () => {
    const app = new Elysia()
      .derive(({ headers: { name } }) => ({
        name
      }))
      .get('/', ({ name }) => name)

    const res = await app
      .handle(
        new Request('http://localhost/', {
          headers: {
            name: 'Elysia'
          }
        })
      )
      .then((t) => t.text())

    expect(res).toBe('Elysia')
  })
})
