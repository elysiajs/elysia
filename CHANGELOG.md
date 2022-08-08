# 0.0.0-experimental.18 - 15 Jul 2022
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
