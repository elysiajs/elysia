# Routing

Common HTTP methods have a built-in methods for convenient usage:
```typescript
app.get("/hi", () => "Hi")
    .post("/hi", () => "From Post")
    .put("/hi", () => "From Put")
    .on("M-SEARCH", async () => "Custom Method")
    .listen(3000)

// [GET] /hi => "Hi"
// [POST] /hi => "From Post"
// [PUT] /hi => "From Put"
// [M-SEARCH] /hi => "Custom Method"
```

To return JSON, simply return any serializable object:
```typescript
app.get("/json", () => ({
    hi: 'KingWorld'
}))

// [GET] /json => {"hi": "KingWorld"}
```

All values returned from handler will be transformed into `Response`.

You can return `Response` if you want to declaratively control the response.
```typescript
app
    .get("/number", () => 1)
    .get("/boolean", () => true)
    .get("/promise", () => new Promise((resovle) => resolve("Ok")))
    .get("/response", () => new Response("Hi", {
        status: 200,
        headers: {
            "x-powered-by": "KingWorld"
        }
    }))

// [GET] /number => "1"
// [GET] /boolean => "true"
// [GET] /promise => "Ok"
// [GET] /response => "Hi"
```

You can use `ctx.status` to explictly set status code without creating `Response`
```typescript
app
    .get("/401", ({ status }) => {
        status(401)

        return "This should be 401"
    })
```

Files are also transformed to response. Simply return `Bun.file` to serve static file.
```typescript
app.get("/tako", () => Bun.file('./example/takodachi.png'))
```

To get path paramameters, prefix the path with a colon:
```typescript
app.get("/id/:id", ({ params: { id } }) => id)

// [GET] /id/123 => 123
```

Wildcard works as expected:
```typescript
app.get("/wildcard/*", () => "Hi")

// [GET] /wildcard/ok => "Hi"
// [GET] /wildcard/abc/def/ghi => "Hi"
```

For a fallback page, use `default`:
```typescript
app.get("/", () => "Hi")
    .default(() => new Response("Not stonk :(", {
        status: 404
    }))

// [GET] / => "Not stonk :("
```

You can group multiple route with a prefix with `group`:
```typescript
app
    .get("/", () => "Hi")
    .group("/auth", app => {
        app
            .get("/", () => "Hi")
            .post("/sign-in", ({ body }) => body)
            .put("/sign-up", ({ body }) => body)
    })
    .listen(3000)

// [GET] /auth/sign-in => "Hi"
// [POST] /auth/sign-in => <body>
// [PUT] /auth/sign-up => <body>
```

And you can decouple the route logic to a separate plugin.
```typescript
import KingWorld, { type Plugin } from 'kingworld'

const hi = (app: KingWorld) => app
    .get('/hi', () => 'Hi')

const app = new KingWorld()
    .use(hi)
    .get('/', () => 'KINGWORLD')
    .listen(3000)

// [GET] / => "KINGWORLD"
// [GET] /hi => "Hi"
```

Lastly, you can specified `hostname` to `listen` if need:
```typescript
import KingWorld, { type Plugin } from 'kingworld'

const app = new KingWorld()
    .get('/', () => 'KINGWORLD')
    .listen({
        port: 3000,
        hostname: '0.0.0.0'
    })

// [GET] / => "KINGWORLD"
```