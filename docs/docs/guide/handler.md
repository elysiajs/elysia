# Handler
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