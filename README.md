# KingWorld
Fast, and Low overhead Bun web server

###### Named after my favorite VTuber (Shirakami Fubuki) and composer (Sasakure.UK) song [KINGWORLD/白上フブキ(Original)](https://youtu.be/yVaQpUUAzik)

## Notable Caveat
- [Bun slow down when use `await`](https://github.com/oven-sh/bun/issues/567)
- [`body` is empty](https://github.com/oven-sh/bun/issues/530)
- [Listener start after 4 seconds on Ubuntu](https://github.com/oven-sh/bun/issues/530#issuecomment-1179686347)

## Quick Start
KingWorld is a web framework based on [Bun](https://bun.sh).

```bash
bun add kingworld
```

Now create `index.ts`, and place the following:
```typescript
import KingWorld from 'kingworld'

new KingWorld()
    .get("/", () => "🦊 Now foxing")
    .listen(3000)
```

And run the server:
```bash
bun index.ts
```

Then simply open `http://localhost:3000` in your browser.

Congrats! You have just create a new web server in KingWorld 🎉🎉

## Routing
KingWorld use a modified version of [trek-router](https://github.com/SaltyAom/trek-router), one of the fastest router available.

Common HTTP Method has a built-in method for a convenient usage:
```typescript
app.get("/hi", () => "Hi")
    .post("/hi", () => "From Post")
    .put("/hi", () => "From Put")
    .on("CUSTOM-METHOD", async () => "Custom Method")
    .listen(3000)
```

To return JSON, simply return any serializable object:
```typescript
app.get("/json", () => ({
    hi: 'KingWorld'
}))
```

All value return from handler will be transformed into `Response`.

You can return `Response` if you want to declaratively control the response.
```typescript
app.get("/response", () => new Response("Hi", {
    status: 200
}))
```

To get path paramameters, simply prefix path with a colon:
```typescript
app.get("/id/:id", ({ params: { id } }) => id)
```

To ensure the type, simply pass a generic:
```typescript
app.get<{
    params: {
        id: string
    }
}>("/id/:id", ({ params: { id } }) => id)
```

Alas, you can group multiple route with a prefix with `group`:
```typescript
app
    .get("/", () => "Hi")
    .group("/auth", app => {
        app.post("/sign-in", ({ body }) => body)
            .put("/sign-up", ({ body }) => body)
    })
    .listen(3000)
```

Finally, you can decouple the route logic to a separate plugin.
```typescript
import KingWorld, { type Plugin } from 'kingworld'

const hi: Plugin = (app) => app
    .get('/hi', () => 'Hi')

const app = new KingWorld()
    .use(hi)
    .get('/', () => 'KINGWORLD')
    .listen(3000)
```
