import { Elysia } from '../src'

// This uses aot: true by default in 1.4 (broken on Bun)
const app = new Elysia({ systemRouter: true })
  .get("/", "Hello Elysia")
  .get("/json", () => ({ message: "Hello World", timestamp: Date.now() }))

Bun.serve({
	port: 3000,
	fetch: app.fetch
})
