import { describe, it, expect } from 'bun:test'
import { Elysia } from '../src'
import { req } from './utils'

describe('store', () => {
  it('work', async () => {
    const app = new Elysia()
      .state('hi', () => 'hi')
      .get('/', ({ store: { hi } }) => hi())

    const res = await app.handle(req('/')).then((r) => r.text())
    expect(res).toBe('hi')
  })

  it('inherits plugin', async () => {
    const plugin = () => (app: Elysia) => app.state('hi', () => 'hi')

    const app = new Elysia().use(plugin()).get('/', ({ store: { hi } }) => hi())

    const res = await app.handle(req('/')).then((r) => r.text())
    expect(res).toBe('hi')
  })

  it('accepts any type', async () => {
    const app = new Elysia()
      .state('hi', {
        there: {
          hello: 'world'
        }
      })
      .get('/', ({ store: { hi } }) => hi.there.hello)

    const res = await app.handle(req('/')).then((r) => r.text())
    expect(res).toBe('world')
  })

  it('accepts multiple', async () => {
    const app = new Elysia()
      .state({
        hello: 'world',
        my: 'name'
      })
      .get('/', ({ store: { hello } }) => hello)

    const res = await app.handle(req('/')).then((r) => r.text())
    expect(res).toBe('world')
  })
})
