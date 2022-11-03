# Store
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

