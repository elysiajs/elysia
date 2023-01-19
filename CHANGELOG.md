# 0.2.0-beta.0 - 17 Jan 2023
Feature:
- Support for Async / lazy-load plugin

Improvement:
- Decode URI parameter path parameter
- Handle union type correctly

# 0.1.3 - 12 Jan 2023
Improvement:
- Validate `Response` object
- Union type inference on response

# 0.1.2 - 31 Dec 2022
Bug fix:
- onRequest doesn't run in `group` and `guard`

# 0.1.1 - 28 Dec 2022
Improvement:
- Parse encoded URI on querystring
- Exclude URI fragment from querystring
- Blasphemy hack for updating Elysia server using `--hot`
- Exclude fragment on `getPath`

# 0.1.0 - 24 Dec 2022
[[Reburn](https://youtu.be/xVPDszGmTgg?t=1139)] is the first *stable* beta release for Elysia.

Happy Christmas, wishing you happy tonight as we release the first stable release of Elysia.

With this API is now stabilized, and Elysia will focus on growing its ecosystem and plugins for common patterns.

## Eden
Introducing [Eden](https://elysiajs.com/collections/eden.html), a fully type-safe client for Elysia server like tRPC.

A 600 bytes client for Elysia server, no code generation need, creating a fully type-safe, and auto-complete for both client and server.

See Eden in action [on Twitter](https://twitter.com/saltyAom/status/1602362204799438848?s=20&t=yqyxaNx_W0MNK9u3wnaK3g)

## The fastest
With a lot effort put into micro-optimization and re-architecture, Elysia is the fastest Bun web framework benchmarked on 24 December 2022, outperformed 2/3 category put into test.

See benchmark results at [Bun http benchmark](https://github.com/SaltyAom/bun-http-framework-benchmark)

## Improved Documentation
Elysia now have an improved documentation at [elysiajs.com](https://elysiajs.com).

Now with a proper landing page, searchable content, and revised content put into.

## Afterward
Merry Christmas, and happy new year.

As 0.1 released, we recommended to give Elysia a try and build stuff with it.

With the wonderful tools, we are happy to looking forward to see what wonderful software will you build.

---

> Fly away, let me fly away
> Never hide in dark
> Head on, start a riot
> Fly away, defying fate in my way
> Crush it
> Make it!
> Feel
> My
> Heart!

# 0.1.0.rc.10 - 21 Dec 2022
Change:
- Remove cjs format as Bun can import ESM from CJS
- Remove comment on build file, rely on .t.ds instead

# 0.1.0.rc.9 - 19 Dec 2022
Change:
- Support plugins which use `getPath`, and `mapQuery` on 0.1.0-rc.6

# 0.1.0.rc.8 - 16 Dec 2022
Improvement:
- Infers type from `group`, and `guard`

Change:
- `Elysia.handle` now only accept valid `URL`

# 0.1.0.rc.7 - 15 Dec 2022
Improvement:
- Minor optimization
- `Router.register` now returns type
- Inline default bodyParser

# 0.1.0.rc.6 - 13 Dec 2022
Fix:
- `.listen` object is now optional

# 0.1.0.rc.5 - 13 Dec 2022
Breaking Change:
- `onError` change its type:
```typescript
// Previously
onError: (error: Error, code: ErrorCode)

// Now
onError: (params: {
    error: Error
    code: ErrorCode
    set: Context['set']
}) => any
```

To migrate, add curly brace to `onError` parameters.

- `onRequest` change its type:
```typescript
// Previously
onRequest: (request: Request, store: Instance['Store']) => any

// Now
onRequest: (params: {
    request: Request,
    store: Instance['store']
    set: Context['set']
})
```
To migrate, add curly brace to `onRequest` parameters.

Feature:
- Manual patch for [bun#1435](https://github.com/oven-sh/bun/issues/1435), and unblock test suite for error handler.

# 0.1.0.rc.4 - 12 Dec 2022
Fix:
- Remove `console.log` for '*'

# 0.1.0.rc.3 - 12 Dec 2022
Feature:
- Strict type for `SCHEMA`
- Infered type parameters for `SCHEMA`

Fix:
- Auto prefix path with `/` for non
- Fallback catch all route for registered parameter

# 0.1.0.rc.2 - 8 Dec 2022
Fix:
- skip body parsing for 'HEAD'
- missing response status on some error
- compatability for cjs
- add main fields for Bundlephobia supports
- add declaration file for both esm and cjs
- ship `src` for TypeScript support with `declare global`

# 0.1.0.rc.1 - 6 Dec 2022
Stabilized API

Feature:
- add header access to context via `context.header`

Breaking Change:
- rename `schema.header` to `schema.headers`

# 0.0.0-experimental.55 - 1 Dec 2022
Bug fix:
- `inject` now accept `Context`

# 0.0.0-experimental.54 - 1 Dec 2022
Feature:
- `derive` to creating derive state
- `inject` to decorate method based on context

# 0.0.0-experimental.53 - 24 Nov 2022
Feature:
- `.all` for registering path with any method

Improvement:
- `getSchemaValidator` now infer output type to be reusable with `@kingworldjs/tpc`

Bug fix:
- `handler.hooks` is undefined on 404

# 0.0.0-experimental.52 - 23 Nov 2022
Improvement:
- Decorators is now lazily allocate
- `.serve` now accept numberic string as port for convenient with `process.env`

# 0.0.0-experimental.51 - 22 Nov 2022 
[[Just Right Slow]](https://youtu.be/z7nN7ryqU28) introduce breaking major changes of KingWorld, specific on a plugin system.

Previously, we define plugin by accepting 2 parameters, `KingWorld` and `Config` like this:
```typescript
const plugin = (app: KingWorld, config) => app

new KingWorld().use(plugin, {
    // Provide some config here
})
```

However, this has flaw by the design because:
- No support for async plugin
- No generic for type inference
- Not possible to accept 3...n parameters (if need)
- Hard/heavy work to get type inference

To fix all of the problem above, KingWorld now accept only one parameter.

A callback which return KingWorld Instance, but accept anything before that.
```typescript
const plugin = (config) => (app: KingWorld) => app

new KingWorld().use(plugin({
    // provide some config here
}))
```

This is a workaround just like the way to register async plugin before exp.51, we accept any parameters in a function which return callback of a KingWorld instance.

This open a new possibility, plugin can now be async, generic type is now possible.

More over that, decorate can now accept any parameters as it doesn't really affect any performance or any real restriction.

Which means that something like this is now possible.
```typescript
const a = <Name extends string = string>(name: Name) => (app: KingWorld) => app.decorate(name, {
    hi: () => 'hi'
})

new KingWorld()
    .use(a('customName'))
    // Retrieve generic from plugin, not possible before exp.51
    .get({ customName } => customName.hi())
```

This lead to even more safe with type safety, as you can now use any generic as you would like.

The first plugin to leverage this feature is [jwt](https://github.com/saltyaom/kingworld-jwt) which can introduce jwt function with custom namespace which is type safe.

Change:
- new `decorators` property for assigning fast `Context`

# 0.0.0-experimental.50 - 21 Nov 2022 
Improvement:
- Faster router.find performance
- Faster query map performance
- Early return on not found
- Better type for `router`

Change:
- Remove `storeFactory` from router

# 0.0.0-experimental.49 - 19 Nov 2022 
Bug fix:
- Conditionally return header in response

# 0.0.0-experimental.48 - 18 Nov 2022 
Bug fix:
- Import Context as non-default
- TypeScript's type not infering Context

# 0.0.0-experimental.47 - 18 Nov 2022 
Bug fix:
- Remove `export default Context` as it's a type
- Import Context as non-default

# 0.0.0-experimental.46 - 18 Nov 2022 
Bug fix:
- Add custom response to `Blob`

# 0.0.0-experimental.45 - 18 Nov 2022 
Bug fix:
- Set default HTTP status to 200 (https://github.com/oven-sh/bun/issues/1523)

# 0.0.0-experimental.44 - 18 Nov 2022 
Improvement:
- Faster object iteration for setting headers
- `KingWorld` config now accept `Serve` including `SSL`

Change:
- Use direct comparison for falsey value

# 0.0.0-experimental.42 - 13 Nov 2022 
Bug fix:
- Router doesn't handle part which start with the same letter

# 0.0.0-experimental.41 - 9 Nov 2022 
Change:
- Internal schema now use correct OpenAPI type (KingWorld need CORRECTION 💢💢)

# 0.0.0-experimental.40 - 9 Nov 2022 
Breaking Change:
- `Context` is now `interface` (non-constructable)
- `responseHeaders`, `status`, `redirect` is now replaced with `set`
    - To migrate:
    ```typescript
    // From
    app.get('/', ({ responseHeaders, status, redirect }) => {
        responseHeaders['server'] = 'KingWorld'
        status(401)
        redirect('/')
    })

    // To
    app.get('/', ({ set }) => {
        set.headers['server'] = 'KingWorld'
        set.status = 401
        set.redirect = '/'
    })
    ```

Improvement:
- Global `.schema` now infer type for handler
- Add JSDocs for main method with example
- `.listen` now accept `Bun.Server` as a callback function
- Response support for `FileBlob`

# 0.0.0-experimental.39 - 8 Nov 2022 
Breaking Change:
- `method` is changed to `route`

Improvement:
- `LocalHook` now prefers the nearest type instead of the merge
- Merge the nearest schema first
- add `contentType` as a second parameter for `BodyParser`

Bug fix:
- Correct type for `after handle`
- Fix infinite cycling infer type for `Handler`

# 0.0.0-experimental.38 - 7 Nov 2022 
Bug fix:
- Correct type for `afterHandle`

# 0.0.0-experimental.37 - 6 Nov 2022 
[[Sage]](https://youtu.be/rgM5VGYToQQ) is one of the major experimental releases and breaking changes of KingWorld.

The major improvement of Sage is that it provides almost (if not) full support for TypeScript and type inference.

## Type Inference
KingWorld has a complex type of system. It's built with the DRY principle in mind, to reduce the developer's workload.

That's why KingWorld tries to type everything at its best, inferring type from your code into TypeScript's type.

For example, writing schema with nested `guard` is instructed with type and validation.
This ensures that your type will always be valid no matter what, and inferring type to your IDE automatically.
![FgqOZUYVUAAVv6a](https://user-images.githubusercontent.com/35027979/200132497-63d68331-cf96-4e12-9f4d-b6a8d142eb69.jpg)

You can even type `response` to make your that you didn't leak any important data by forgetting to update the response when you're doing a migration.

## Validator
KingWorld's validator now replaced `zod`, and `ajv` with `@sinclair/typebox`.

With the new validator, validation is now faster than the previous version by 188x if you're using zod, and 4.1x if you're using ajv adapter.

With Edge Computing in mind, refactoring to new validate dropped the unused packages and reduced size by 181.2KB. 
To give you an idea, KingWorld without a validator is around 10KB (non-gzipped).

Memory usage is also reduced by almost half by changing the validator.
###### According to M1 Max running `example/simple.ts`, running exp.36 uses 24MB of memory while exp.37 use 12MB of memory

This greatly improves the performance of KingWorld in a long run.

## Changelog
Breaking Change:
- Replace `zod`, `zod-to-json-schema`, `ajv`, with `@sinclair/typebox`

Improvement:
- `use` now accept any non `KingWorld<{}, any>`
- `use` now combine typed between current instance and plugin
- `use` now auto infer type if function is inline
- `LocalHook` can now infer `params` type from path string

Change:
- `TypedSchema` is now replaced with `Instance['schema']`

# 0.0.0-experimental.36 - 4 Nov 2022 
Breaking Change:
- `AfterRequestHandle` now accept (`Context`, `Response`) instead of `(Response, Context)`

Improvement:
- `.guard` now combine global and local recursively
- `.use` now inherits schema

# 0.0.0-experimental.35 - 3 Nov 2022 
Bug fix:
- Remove `console.log` on failed validation

# 0.0.0-experimental.34 - 3 Nov 2022 
Improvement:
- Add Ajv 8.11.0
- Error log for validation is updated to `instancePath`

# 0.0.0-experimental.33 - 3 Nov 2022 
Feature:
- `.schema` for global schema validation
- `.start`, `.stop` and accept `KingWorld<Instance>` as first parameter

Improvement:
- `.guard` now auto infer type from schema to `Handler`
- scoped `.guard` now inherits hook
- `NewInstance` now inherits `InheritSchema`

Bug fix:
- Rename `afterHandle` to `onAfterHandle` to match naming convention
- Make `afterHandle` in `RegisterHook` optional
- Internal type conversion between `Hook`, `LocalHook`

# 0.0.0-experimental.32 - 2 Nov 2022 
Feature:
- add `afterHandle` hook

Improvement:
- Using `WithArray<T>` to reduce redundant type

Bug fix:
- `beforeHandle` hook doesn't accept array

# 0.0.0-experimental.31 - 2 Nov 2022
Bug fix:
- Add `zod` by default

# 0.0.0-experimental.30 - 2 Nov 2022
Bug fix:
- Add `zod-to-json-schema` by default

# 0.0.0-experimental.29 - 2 Nov 2022
[Regulus]

This version introduces rework for internal architecture. Refine, and unify the structure of how KingWorld works internally.

Although many refactoring might require, I can assure you that this is for the greater good, as the API refinement lay down a solid structure for the future of KingWorld.

Thanks to API refinement, this version also introduced a lot of new interesting features, and many APIs simplified.

Notable improvements and new features:
- Define Schema, auto-infer type, and validation
- Simplifying Handler's generic
- Unifying Life Cycle into one property
- Custom Error handler, and body-parser
- Before start/stop and clean up effect

# 0.0.0-experimental.28 - 30 Oct 2022
Happy halloween.

This version named [GHOST FOOD] is one of the big improvement for KingWorld, I have been working on lately.
It has a lot of feature change for better performance, and introduce lots of deprecation.

Be sure to follow the migration section in `Breaking Change`.

New Feature:
- Auto infer type from `plugin` after merging with `use`
- `decorate` to extends `Context` method
- add `addParser`, for custom handler for parsing body

Breaking Change:
- Moved `store` into `context.store`
    - To migrate:
    ```typescript
    // From
    app.get(({}, store) => store.a)

    // To
    app.get(({ store }) => store.a)
    ```

- `ref`, and `refFn` is now removed
- Remove `Plugin` type, simplified Plugin type declaration
    - To migrate:
    ```typescript
    // From
    import type { Plugin } from 'kingworld'
    const a: Plugin = (app) => app

    // To
    import type { KingWorld } from 'kingworld'
    const a = (app: KingWorld) => app
    ```

- Migrate `Header` to `Record<string, unknown>`
    - To migrate:
    ```typescript
    app.get("/", ({ responseHeader }) => {
        // From
        responseHeader.append('X-Powered-By', 'KingWorld')

        // To
        responseHeader['X-Powered-By', 'KingWorld']

        return "KingWorld"
    })
    ```

Change:
- Store is now globally mutable

Improvement:
- Faster header initialization
- Faster hook initialization

# 0.0.0-experimental.27 - 23 Sep 2022
New Feature:
- Add `config.strictPath` for handling strict path

# 0.0.0-experimental.26 - 10 Sep 2022
Improvement:
- Improve `clone` performance
- Inline `ref` value
- Using object to store internal route

Bug fix:
- 404 on absolute path

# 0.0.0-experimental.25 - 9 Sep 2022
New Feature:
- Auto infer typed for `params`, `state`, `ref`
- `onRequest` now accept async function
- `refFn` syntax sugar for adding fn as reference instead of `() => () => value`

Improvement:
- Switch from `@saltyaom/trek-router` to `@medley/router`
- Using `clone` instead of flatten object
- Refactor path fn for inline cache
- Refactor `Context` to class 

Bug fix:
- `.ref()` throw error when accept function

# 0.0.0-experimental.24 - 21 Aug 2022
Change:
- optimized for `await`

# 0.0.0-experimental.23 - 21 Aug 2022
New Feature:
- Initialial config is now available, starting with `bodyLimit` config for limiting body size

Breaking Change:
- `ctx.body` is now a literal value instead of `Promise`
    - To migrate, simply remove `await`

Change: 
- `default` now accept `Handler` instead of `EmptyHandler`

Bug fix:
- Default Error response now return `responseHeaders`
- Possibly fixed parsing body error benchmark

# 0.0.0-experimental.22 - 19 Aug 2022
Breaking Change:
- context.body is now deprecated, use request.text() or request.json() instead

Improvement:
- Using reference header to increase json response speed
- Remove `body` getter, setter

Change:
- Using `instanceof` to early return `Response`

# 0.0.0-experimental.21 - 14 Aug 2022
Breaking Change:
- `context.headers` now return `Header` instead of `Record<string, string>`

Feature:
- Add status function to `Context`
- `handle` now accept `number | Serve`
- Remove `querystring` to support native Cloudflare Worker
- Using raw headers check to parse `body` type

# 0.0.0-experimental.20 - 13 Aug 2022
Feature:
- Handle error as response

# 0.0.0-experimental.19 - 13 Aug 2022
Change:
- Use Array Spread instead of concat as it's faster by 475%
- Update to @saltyaom/trek-router 0.0.7 as it's faster by 10%
- Use array.length instead of array[0] as it's faster by 4%

# 0.0.0-experimental.18 - 8 Aug 2022
Change:
- With lazy initialization, KingWorld is faster by 15% (tested on 14' M1 Max)
- Micro optimization
- Remove `set` from headers

# 0.0.0-experimental.17 - 15 Jul 2022
Change:
- Remove dependencies: `fluent-json-schema`, `fluent-schema-validator`
- Update `@saltyaom/trek-router` to `0.0.2`

# 0.0.0-experimental.16 - 15 Jul 2022
Breaking Change:
- Move `hook.schema` to separate plugin, [@kingworldjs/schema](https://github.com/saltyaom/kingworld-schema)
    - To migrate, simply move all `hook.schema` to `preHandler` instead

Change:
- Rename type `ParsedRequest` to `Context`
- Exposed `#addHandler` to `_addHandler`

# 0.0.0-experimental.15 - 14 Jul 2022
Breaking Change:
- Rename `context.responseHeader` to `context.responseHeaders`
- Change type of `responseHeaders` to `Header` instead of `Record<string, string>`
