# 🦊 KingWorld
Fast, and friendly [Bun](https://bun.sh) web framework.

Focusing on **speed**, and **simplicity**.

###### Named after my favorite VTuber (Shirakami Fubuki) and composer (Sasakure.UK) song [KINGWORLD/白上フブキ(Original)](https://youtu.be/yVaQpUUAzik)

## Feature
- Speed - Build for speed and optimized for Bun in mind.
- Scalable - Designed for micro-service, decoupled logic and treat everything as building block
- Simplicity - Composed patterns into plugin, removing redundant logic into one simple plugin
- Friendliness - Familiar pattern with enhance TypeScript supports eg. auto infers type paramters

⚡️ KingWorld is [one of the fastest Bun web framework](https://github.com/SaltyAom/bun-http-framework-benchmark)

## Ecosystem
KingWorld can be heavily customized with the use of plugins.

Official plugins:
- [Static](https://github.com/saltyaom/kingworld-static) for serving static file/folders
- [Cookie](https://github.com/saltyaom/kingworld-cookie) for reading/setting cookie
- [CORS](https://github.com/saltyaom/kingworld-cors) for handling CORs request

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

## Handler
Handler is a callback function that returns `Response`. Used in HTTP method handler.

```typescript
new KingWorld()
    .get(
        '/', 
        // This is handler
        () => "KingWorld"
    )
    .listen(3000)
```

By default, handler will accepts two parameters: `request` and `store`.
```typescript
// Simplified Handler
type Handler = (request: ParsedRequest, store: Instance['store']) => Response

const handler: Handler = (request: {
    request: Request
    query: ParsedUrlQuery
    params: Record<string, string>
    headers: Record<string, string>
    body: Promise<string | Object>
    responseHeaders: Record<string, unknown>
    store: Record<any, unknown>
})
```

## Handler Request
Handler's request consists of
- request [`Request`]
    - Native fetch Request
- query [`ParsedUrlQuery`]
    - Parsed Query Parameters as `Record<string, string>`
    - Default: `{}`
    - Example:
        - path: `/hi?name=fubuki&game=KingWorld`
        - query: `{ "name": "fubuki", "game": "KingWorld" }`
- params [`Record<string, string>`]
    - Path paramters as object
    - Default: `{}`
    - Example:
        - Code: `app.get("/id/:name/:game")`
        - path: `/id/kurokami/KingWorld`
        - params: `{ "name": "kurokami", "game": "KingWorld" }`
- headers [`Record<string, string>`]
    - Function which returns request's headers
- body [`Promise<string | Object>`]
    - Function which returns request's body
    - By default will return either `string` or `Object`
        - Will return Object if request's header contains `Content-Type: application/json`, and is deserializable
        - Otherwise, will return string
- responseHeaders [`Record<string, unknown>`]
    - Mutable object reference, will attached to response's header
    - For example, adding `CORS` to response as a plugin
- status [`(statusCode: number) => void`]
    - Function to set response status code explictly

## Store
Store is a singleton store of the application.

Is recommended for local state, reference of database connection, and other things that need to be available to be used with handler.

```typescript
new KingWorld()
    .state('build', 0.5)
    .get("/build", ({ store: { build } }) => build)
    .get("/random", ({ store: { random }}) => random)
    .listen(3000)

// [GET] /build => 0.5
```

State will be assigned once start, and it's a mutable global store for server.

## Lifecycle
KingWorld request's lifecycle can be illustrate as the following:
```
Start -> (Loop
    (Try
        request -> parse ->
        | routing |
        transform -> beforeHandle -> <handle> -> afterHandle -> Response
                  -> beforeHandle -> afterHandle -> Response
    Catch -> error)
) -> Stop
```

The callback that assigned to lifecycle is called **hook**.

#### Start
- start [`VoidLifeCycle`]
    - Call right before server start

#### Before Route
- request [`BeforeRequestHandler`]
    - Call on new request
- parse [`BodyParser`]
    - Call while parsing body
    - If truthy value return, value will be assigned to `body`

#### Post Handler
- transform [`Handler`]
    - Called before validating request
    - Use to transform request's body, params, query before validation
- beforeHandle [`Handler`]
    - Handle request before executing path handler
    - If value returned, will skip to Response process
- afterHandle [`AfterRequestHandler`]
    - Handle request after executing path handler
    - Use to transform response of `beforeHandle` and `handle`, eg. compression

#### Stop
- stop [`VoidLifeCycle`]
    - Call after server stop, use for cleaning up

Lifecycle can be assigned with `app.on<lifecycle name>()` or `app.on(lifeCycleName, callback)`:

For example, assigning `transform` to a request:
```typescript
app
    // ? Transform params 'id' to number if available
    .onTransform(({ params }) => {
        if(params.id)
            params.id = +params.id
    })
```

## Local Hook
There's 2 type of hook
- Global Hook
    - Assign to every handler
- Local Hook
    - Assigned by third parameters of `Route Handler` or `app.<method>(path, handler, localHook)`
    - Affected only scoped handler

```typescript
app
    // ? Global Hook
    .onTransform(({ params }) => {
        if(params.id)
            params.id = +params.id + 1
    })
    .get(
        "/id/:id/:name", 
        ({ params: { id, name } }) => `${id} ${name}`,
        // ? Local hook
        {
            transform: ({ params }) => {
                if(params.name === "白上フブキ")
                    params.name = "Shirakami Fubuki"
            }
        }
    )
    .get("/new/:id", ({ params: { id, name } }) => `${id} ${name}`)
    .listen(3000)

// [GET] /id/2/kson => "3 kson"
// [GET] /id/1/白上フブキ => "2 Shirakami Fubuki"
// [GET] /new/1/白上フブキ => "2 白上フブキ"
```

You can have multiple local hooks as well by assigning it as array:
```typescript
app
    .get(
        "/id/:id/:name", 
        ({ params: { id, name } }) => `${id} ${name}`,
        {
            transform: [
                ({ params }) => {
                    if(params.id)
                        params.id = +params.id + 1
                },
                ({ params }) => {
                    if(params.name === "白上フブキ")
                        params.name = "Shirakami Fubuki"
                }
            ]
        }
    )
    .listen(3000)

// [GET] /id/2/kson => "3 kson"
// [GET] /id/1/白上フブキ => "2 Shirakami Fubuki"
// [GET] /new/1/白上フブキ => "2 白上フブキ"
```

### PreRequestHandler
Callback assign to lifecycle before routing.

As it's handle before routing, there's no `params`, `query`.

```typescript
type PreRequestHandler = (request: Request, store: Store) => void
```

Lifecycle that assigned with `PreRequestHandler`:
- onRequest

### Handler (Event)
Callback assign to lifecycle after routing.

Accept same value as [path handler,
