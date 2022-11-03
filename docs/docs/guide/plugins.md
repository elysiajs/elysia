# Plugins

Plugin is used to decouple logic into smaller function.

```typescript
import type KingWorld from 'kingworld'

const hi = (app: KingWorld) => app
    .get('/hi', () => 'Hi')

const app = new KingWorld()
    .use(hi)
    .get('/', () => 'KINGWORLD')
    .listen(3000)

// [GET] / => "KINGWORLD"
// [GET] /hi => "Hi"
```

However, plugin can also be used for assigning new `store`, and `hook` making it very useful.

To register a plugin, simply add plugin into `use`.

`use` can accept 2 parameters:
- plugin [`Plugin`]
- config [`Config?`] (Optional)


```typescript
const plugin = (
    app: KingWorld, 
    // Config (2nd paramters of `use`)
    { prefix = '/fbk' } = {}
) => app
        .group(prefix, (app) => {
            app.get('/plugin', () => 'From Plugin')
        })

new KingWorld()
    .use(app, {
        prefix: '/fubuki'
    })
```

To develop plugin with type support, `Plugin` can accepts generic.

```typescript
const plugin = (app, { prefix = '/fbk' } = {})  => 
    app
        .state('fromPlugin', 'From Logger')
        .onTransform(({ responseHeaders }) => {
            request.log = () => {
                console.log('From Logger')
            }

            responseHeaders['X-POWERED-BY'] = 'KINGWORLD'
        })
        .group(prefix, (app) => {
            app.get('/plugin', () => 'From Plugin')
        })

const app = new KingWorld<{
    Store: {
        build: number
        date: number
    }
}>()
    .use(plugin)
    .get('/', ({ log }) => {
        log()

        return 'KingWorld'
    })

// [GET] /fbk/plugin => "From Plugin"
```

Since Plugin have a type declaration, all request and store will be fully type and extended from plugin.

For example:
```typescript
// Before plugin registration
new KingWorld<{
    Store: {
        build: number
        date: number
    }
}>()

// After plugin registration
new KingWorld<{
    Store: {
        build: number
        date: number
    } & {
        fromPlugin: 'From Logger'
    }
    Request: {
        log: () => void
    }
}>()
```

This will enforce type safety across codebase.

```typescript
const app = new KingWorld<{
    Store: {
        build: number
        date: number
    }
}>()
    .use(plugin)
    .get('/', ({ log }) => {
        // `log` get type declaration reference from `plugin`
        log()

        return 'KingWorld'
    })
```

### Local plugin custom type
Sometime, when you develop local plugin, type reference from main instance is need, but not available after separation.

```typescript
const plugin = (app: KingWorld)  => 
    app
        .get("/user/:id", ({ db, params: { id } }) => 
            // ❌ Type Error: db is not defined or smth like that
            db.find(id)
        )

const app = new KingWorld<{
    Store: {
        database: Database
    }
}>()
    .state('db', database)
    .use(plugin)
```

That's why plugin can accept the third generic for adding temporary local type but do not extend the main instance.
```typescript
import type KingWorld from 'kingworld'

const plugin = (app: KingWorld)  => 
    app
        .get("/user/:id", ({ db, params: { id } }) => 
            // ✅ db is now typed
            db.find(id)
        )

const app = new KingWorld()
    .state('db', database)
    .use(plugin)
```

## Async Plugin
To create an async plugin, simply create an async function return callback for plugin.

```typescript
const plugin = async () => {
    const db = await setupDatabase()

    return (app: KingWorld) => 
        app
            .state('db', database)
            .get("/user/:id", ({ db, params: { id } }) => 
                // ✅ db is now typed
                db.find(id)
            )
}

const app = new KingWorld()
    .state('db', database)
    .use(await plugin())
```

## KingWorld Instance
KingWorld can accepts named generic to type global instance.

For example, type-strict store.

```typescript
const app = new KingWorld<{
    Store: {
        build: number
    }
}>()
    .state('build', 1)
```

KingWorld instance can accept generic of `KingWorldInstance`
```typescript
export interface KingWorldInstance<
	Store extends Record<string, any> = {},
	Request extends Record<string, any> = {}
> {
	Request?: Request
	Store: Store
}
```