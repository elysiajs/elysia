# Lifecycle
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
There are 2 types of hook
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
Callback assigned to lifecycle before routing.

As it handles before routing, there are no `params` and `query`.

```typescript
type PreRequestHandler = (request: Request, store: Store) => void
```

Lifecycle that assigned with `PreRequestHandler`:
- onRequest

### Handler (Event)
Callback assign to lifecycle after routing.

Accept same value as [path handler, @see Handler](/handler.html#handler-request)

Lifecycle that assigned with `Handler`:
- transform
- beforeHandle

## Transform
Use to modify request's body, params, query before validation.

```typescript
app
    .get(
        "/gamer/:name", 
        ({ params: { name }, hi }) => hi(name),
        // ? Local hook
        {
            transform: ({ params }) => {
                if(params.name === "白上フブキ")
                    params.name = "Shirakami Fubuki"
                    
                params.hi = (name: string) => `Hi ${name}`
            }
        }
    )

// [GET] /gamer/白上フブキ => "Shirakami Fubuki"
// [GET] /gamer/Botan => "Botan"
```

You can easily modify body in transform to decouple logic into separate plugin.
```typescript
import { z } from 'zod'

new KingWorld()
	.post(
		'/gamer',
		async ({ body }) => {
			const { username } = body

			return `Hi ${username}`
		},
		{
            schema: {
                body: z.object({
                    id: z.number(),
                    username: z.string()
                })
            }
			transform: (request) => {
				request.body.id = +request.body.id
			}
		}
	)
	.listen(8080)
```