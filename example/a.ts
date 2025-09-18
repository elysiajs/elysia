import { Elysia, t } from '../src'

new Elysia()
  .decorate("db", Object.freeze({ hello: "world" }))
  .guard({}, app => app)
