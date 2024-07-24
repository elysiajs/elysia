# 1.1.4 - 23 Jul 2024
Feature:
- [#718](https://github.com/elysiajs/elysia/pull/718) implement normalization support for class instances with getter functions

Bug fix:
- removeColonAlias accidentally slice -2 end index for last parameter
- [#726](https://github.com/elysiajs/elysia/pull/726) lazy instantiation of `stringToStructureCoercions`
- [#750](https://github.com/elysiajs/elysia/issues/750) Cookie: Right side of assignment cannot be destructured
- [#749](https://github.com/elysiajs/elysia/issues/749) Query params following an array query are parsed as array items
- [#751](https://github.com/elysiajs/elysia/issues/751) Dynamic mode response failed if null or undefined value is returned
- [#741](https://github.com/elysiajs/elysia/issues/741) stream stringify object

# 1.1.3 - 17 Jul 2024
Change:
- sucrose: exact inference name
- use `mapResponse` instead of `mapCompactResponse` for stream
	- [#727](https://github.com/elysiajs/elysia/issues/727)
- defers first stream execution before returning response
	- [#729](https://github.com/elysiajs/elysia/issues/729)
- [#722](https://github.com/elysiajs/elysia/issues/722) derive context is not passed to onError

Bug fix:
- `onError` with scope not being able to infer context type

# 1.1.2 - 16 Jul 2024
Bug fix:
- [#724](https://github.com/elysiajs/elysia/issues/724), [bun#12594](https://github.com/oven-sh/bun/issues/12594) sucrose: possibly fix `bun build --compile` not being able to infer first, and last context parameter
- derive is being override by resolve in certain function
	- [#722](https://github.com/elysiajs/elysia/issues/722) Type error with global `app.derive` followed by onError
- params on `onError` is now `{ [key in string]: string }` instead of `never`
- [#721](https://github.com/elysiajs/elysia/issues/721) unexpected isContextPassToFunction: minified whitespace of arrow function causing inaccurate separateFunction

# 1.1.1 - 16 Jul 2024
Breaking Change:
- parse query as `string` instead of `string | string[]` unless specified

# 1.1.0 - 16 Jul 2024
Feature:
- Trace v2
- Normalization is on by default
- Data type coercion
- Guard as, bulk as cast
- Response status coercion
- Optional path parameter
- Generator response stream

Breaking Change:
- Parse value as string for all validators unless explicitly specified.
    - See [50a5d92](https://github.com/elysiajs/elysia/commit/50a5d92ea3212c5f95f94552e4cb7d31b2c253ad), [44bf279](https://github.com/elysiajs/elysia/commit/44bf279c3752c6909533d19c83b24413d19d27fa).
    - Remove objects auto-parsing in query unless explicitly specified via query
   	- Except query string as defined in RFC 3986, TLDR; query string could be either string or array of string.
- Rename `onResponse` to `onAfterResponse`
- [Internal] Remove $passthrough in favor of toResponse
- [Internal] UnwrapRoute type now always resolve with status code

Improvement:
- Add auto-complete for `set.headers`
- Add `server` property
- `onError` supports array function
- Parse query object with and without schema
- Sucrose: improve isContextPassToFunction, and extractMainParameter stability
- Add `replaceSchemaType`
- Add `route` to `context`
- Optimize recursive MacroToProperty type
- Parse query array and object
- Optimize code path for `composeGeneralHandler`
- Add debug report on compiler panic
- Reduce memory usage of route registration ~36% on large codebase
    - Reduce compilation code path
    - Remove trace inference
    - Reduce router compilation code path
    - removing route handler compilation cache (st${index}, stc${index})
- Add undefined union to cookie in case if cookie is not present
- Optimize response status resolve type inference

Change:
- Deprecated `ObjectString` for parsing array
- Using `Cookie<unknown>` instead of `Cookie<any>` if schema is not defined
- Remove prototype poluation from hook
- remove static analysis for query name
- remove query replace '+' in favor removing static query analysis
- mapResponse is now called in error event
- reconcilation decorator in type level

Bug fix:
- Normalize headers accidentally use query validator check instead
- `onError` missing trace symbol
- Headers validator compilation is not cached
- Deduplicate macro propagation
- Websocket in nested group now work
- Error response is not check unless successful status code is provided

# 1.0.27 - 2 Jul 2024
Bug fix:
- [#640](https://github.com/elysiajs/elysia/issues/640) Unable to access root level macros in plugins
- [#606](https://github.com/elysiajs/elysia/issues/606) Object encoding in query parameters

# 1.0.26 - 30 Jun 2024
Bug fix:
- mapResponse is not called on beforeHandle, and afterHandle

# 1.0.25 - 21 Jun 2024
Bug fix:
- type is resolved as `File` if `@types/bun` is not installed when using with Eden Treaty

# 1.0.24 - 18 Jun 2024
Bug fix:
- `derive`, `resolve` support void return
- [#677](https://github.com/elysiajs/elysia/issues/677) Query params validation for array of string fail

# 1.0.23 - 9 Jun 2024
Feature:
- add `toResponse` for mapping custom response
- [#606](https://github.com/elysiajs/elysia/issues/606) Object encoding in query parameters

Bug fix:
- [#654](https://github.com/elysiajs/elysia/pull/654) set correct normalization behavior for addtional properties
- [#649](https://github.com/elysiajs/elysia/pull/649) cookie decode value might be null
- [#664](https://github.com/elysiajs/elysia/issues/664) "default" option is not being applied on validation
- [#656](https://github.com/elysiajs/elysia/issues/656) ctx.query doesn't work in some case
    - set forceDynamicQuery to true by default
- [#658](https://github.com/elysiajs/elysia/issues/658) aot does not recognize the use of ctx.body within a try catch
- [#630](https://github.com/elysiajs/elysia/issues/630) accessing ctx.query directly breaks the object

# 1.0.22 - 23 May 2024
Breaking Change:
- set default cookie path to `/`

Feature:
- add `form` utility for returning explicit formdata
- add object with image to return as `formdata`

Bug fix:
- return `Bun.file` by specifying `t.File()` and `t.Object({ any: t.File() })` as a response

# 1.0.21 - 21 May 2024
Breaking Change:
- `t.type({ error })` now accepts `(error: ({ type, validator, value, errors }) => unknown)` instead of `(error: (type, validator, value) => unknown)`

Improvement:
- `t.type({ error })` accepts `string | number | boolean | Object` instead of `string`
- `t.type({ error })` return `string | number | boolean | Object | void` instead of `string`
- add `errors: ValueError[]` to `t.type({ error({ errors }) {} })`

Bug fix:
- [#644](https://github.com/elysiajs/elysia/issues/644) redirect doesn't work with `aot: false`
- [#641](https://github.com/elysiajs/elysia/issues/641) cookie schema validation doesn't work with `aot: true`
- [#615](https://github.com/elysiajs/elysia/issues/615) highlight derive and resolve when using `onError`

# 1.0.20 - 13 May 2024
Bug fix:
- macro is not inherits inside group

# 1.0.19 - 13 May 2024
Bug fix:
- remove set.clone spread operator for mapping Response

# 1.0.18 - 11 May 2024
Feature:
- add support for partitioned cookie

Bug fix:
- recursive MacroToProperty type on unknown macro

# 1.0.17 - 9 May 2024
Improvement:
- add context.url to get full URL string (including query)
- reduce query parsing instruction

# 1.0.16 - 2 May 2024
Bug fix:
- [ratelimit#28](https://github.com/rayriffy/elysia-rate-limit/issues/28) trace hang when using server-timing with rate-limit plugin

# 1.0.15 - 27 Apr 2024
Feature:
- add `redirect` function to `Context`

Improvement:
- sucrose: remove unreachable query bracket check, reduce bracket instruction
- sucrose: query accessor keyword check at initialization instead of in loop
- sucrose: remove accessor check
- sucrose: skip query check for immediate return

Change:
- sucrose: add `isArrowReturn` to `separateFunction`
- sucrose: skip inference queries check if `query` is not found

Change:
- allow custom parser when `type` is specified
- add `contentType` to context
- soft deprecate `contentType` as 2nd `parse` parameter

Bug fix:
- [#622](https://github.com/elysiajs/elysia/issues/622) sucrose: mistake cookie for query
- duplicate format found
- using `parse`, `type`, `body` generate invalid syntax

# 1.0.14 - 22 Apr 2024
Improvement:
- [#596](https://github.com/elysiajs/elysia/pull/596) account for 20x response status schemas for type safety

Bug fix:
- [#615](https://github.com/elysiajs/elysia/issues/615)
- [588](https://github.com/elysiajs/elysia/issues/588) separate async derive/resolve function doesn't get await
- primitive thrown result in invalid type

# 1.0.12 - 5 Apr 2024
Improvement:
- export `InferContext` and `InferHandler`

Bug fix:
- remove accidental `console.log` in `compile`

# 1.0.12 - 5 Apr 2024
Feature:
- add `InferContext`

Bug fix:
- returning null with response validation cause error

# 1.0.11 - 2 Apr 2024
Bug fix:
- possibly fix for "Duplicate type kind 'Files' detected"
- add ajv-formats
- [#562](https://github.com/elysiajs/elysia/pull/575) %26 (&) to be interpreted as & (query separator)

# 1.0.10 - 30 Mar 2024
Bug fix:
- [ServerTiming#1](https://github.com/elysiajs/elysia-server-timing/issues/1) late beforeHandle on set trace inference doesn't produce exit instruction

# 1.0.9 - 25 Mar 2024
Feature:
- `Elysia.config.detail` constructor
- shorthand `Elysia.tags` to constructor, `LocalHook`
- guard inherits detail

Bug fix:
- inference link on `precompile: false` creating unnecessary instruction

# 1.0.8 - 25 Mar 2024
Feature:
- [#562](https://github.com/elysiajs/elysia/pull/562) add `normalize` config

Improvement:
- Scope cookie instruction to route level instead of global config
- [#557](https://github.com/elysiajs/elysia/pull/557) cache tsc buildinfo for running faster
- [#551](https://github.com/elysiajs/elysia/pull/551) use AnyElysia instead of inline Elysia<any>

Bug fix:
- [#564](https://github.com/elysiajs/elysia/pull/564) Fixing "ReadableStream is locked"
- [#552](https://github.com/elysiajs/elysia/pull/552) fix: shift promise in PromiseGroup even when rejected

# 1.0.7 - 20 Mar 2024
Feature:
- add Elysia.propagate to propagate hook type from 'local' to 'scoped'

Improvement:
- remove function.$elysia
- remove function extension

Bug fix:
- duplicate macro call
- [#548](https://github.com/elysiajs/elysia/issues/548) additional case for "accessing all query params using property name (ctx.query) doesn't work anymore"
- [#599](https://github.com/elysiajs/elysia/issues/559) plugin with scoped settings not functioning correctly

# 1.0.6 - 20 Mar 2024
Bug fix:
- inline function doesn't propagate correctly on type level

# 1.0.5 - 19 Mar 2024
Improvement:
- using regex for date pattern matching before using new Date validation
- using tsc to emit declaration file instead of tsup
- add `mapResponse` to MacroManager

Bug fix:
- Ephemeral and Volatile type isn't recognize by MacroManager
- inline guard cookie doesn't apply to local instance

# 1.0.4 - 18 Mar 2024
Improvement:
- resolve, derive soundness

# 1.0.3 - 18 Mar 2024
Improvement:
- Reduce instruction for static resource

Bug fix:
- Fix returning mulitple status code using `error` doesn't accept the response

# 1.0.2 - 18 Mar 2024
Feature:
- add `scoped` support for `derive` and `resolve`

Improvement:
- Type soundness
- type inference performance improvement

# 1.0.1 - 18 Mar 2024
Improvement:
- `mapHandler` now check passthrough once instead of twice
- exclude return type of`ELYSIA_RESPONSE` type from `derive` and `resolve`
- throw error if `error` is return in `derive` and `resolve`
- handle `return error` on `transform`
- [#502](https://github.com/elysiajs/elysia/pull/502) merge response schema from parent scope

Bug fix:
- explicit `type: 'json'` with body schema throw unexpected `body.Check` is not a function
- [#549](https://github.com/elysiajs/elysia/pull/549) await the .modules of nested Elysia instances
- [#548](https://github.com/elysiajs/elysia/issues/548) Accessing all query params using property name (ctx.query) doesn't work anymore

# 1.0.0 - 16 Mar 2024
Improvement:
- fine-grained reactive cookie
- using single source of truth for cookie
- macro support for websocket
- add `mapResolve`
- add `{ as: 'global' | 'scoped' | 'local' }` to lifecycle event
- add ephemeral type
- inline `error` to handler
- inline `error` has auto-completion and type checking based on status code
- handler now check return type of `error` based on status code
- utility `Elysia._types` for types inference
- [#495](https://github.com/elysiajs/elysia/issues/495) Provide user friendly error for failed parse
- handler now infers return type for error status for Treaty
- `t.Date` now allow stringified date
- improves type test case
- add test case for all life-cycle
- resolve, mapResolve, derive, mapDerive use ephemeral type to scope down accurately
- inference query dynamic variable

Breaking Change:
- [#513](https://github.com/elysiajs/elysia/issues/513) lifecycle is now local first

Change:
- group private API property
- move `Elysia.routes` to `Elysia.router.history`
- detect possible json before return
- unknown response now return as-is instead of JSON.stringify()
- change Elysia validation error to JSON instead of string
- static content evalute hook JIT instead of AOT

Bug fix:
- [#466](https://github.com/elysiajs/elysia/issues/466) Async Derive leaks request context to other requests if `aot: true`
- [#505](https://github.com/elysiajs/elysia/issues/505) Empty ObjectString missing validation inside query schema
- [#503](https://github.com/elysiajs/elysia/issues/503) Beta: undefined class when using decorate and derive
- onStop callback called twice when calling .stop
- mapDerive now resolve to `Singleton['derive']` instead of `Singleton['store']`
- `ValidationError` doesn't return `content-type` as `application/json`
- validate `error(status, value)` validate per status
- derive/resolve always scoped to Global
- duplicated onError call if not handled
- [#516](https://github.com/elysiajs/elysia/issues/516) server timing breaks beforeHandle guards
- cookie.remove() doesn't set correct cookie path

# 0.8.17 - 12 Feb 2024
Feature:
- [#474](https://github.com/elysiajs/elysia/pull/474) Numeric Cookie with length >= 16 cant be parsed to number
- [#476](https://github.com/elysiajs/elysia/pull/476) Using a query key that contains a hyphen or a dot raises a SyntaxError
- [#460](https://github.com/elysiajs/elysia/pull/460)
    - [#458](https://github.com/elysiajs/elysia/pull/458) Multiple scoped plugins do not register routes
    - [#457](https://github.com/elysiajs/elysia/pull/457) Elysia arguments scoped and prefix do not work at the same time

Change:
- [#472](https://github.com/elysiajs/elysia/pull/472) Move documentation issue template to documentation repository

# 0.8.16 - 6 Feb 2024
Feature:
- [#448](https://github.com/elysiajs/elysia/pull/448) BooleanString - @bogeychan

Bug fix:
- [#451](https://github.com/elysiajs/elysia/pull/464) handle spread operator use on possible null or undefined
- [#460](https://github.com/elysiajs/elysia/pull/460)
    - [#457](https://github.com/elysiajs/elysia/pull/457) scoped plugin instances now respect the prefix property
    - [#458](https://github.com/elysiajs/elysia/pull/458) adding a second scoped plugin does not unmount the route handler of a previously added scoped instance anymore.

# 0.8.15 - 30 Jan 2024
Bug fix:
- [#451](https://github.com/elysiajs/elysia/issues/451) macro does not run when it should (macro deduplication)
- [#450](https://github.com/elysiajs/elysia/issues/450) Local hook parse doesn't get executed with `aot: false`

# 0.8.14 - 26 Jan 2024
Bug fix:
- types are missing in `exports.*`
- [#441](https://github.com/elysiajs/elysia/issues/441) Vite doesn't get bundle without main

# 0.8.13 - 26 Jan 2024
Bug fix:
- types is not import
- bun build regression on export * from '@sinclair/typebox/system'
- update memoirist to use mjs

# 0.8.12 - 26 Jan 2024
Change:
- using .mjs for es module

# 0.8.11 - 26 Jan 2024
Change:
- using tsup instead of swc
- [#441](https://github.com/elysiajs/elysia/issues/441) remove nanoid, using web crypto randomInt instead

Bug fix:
- [#446](https://github.com/elysiajs/elysia/pull/446) numeric string check to use Number instead of parseInt
- [#445](https://github.com/elysiajs/elysia/pull/445) empty body custom response when set.headers is empty

# 0.8.10 - 24 Jan 2024
Bug fix:
- [#440](https://github.com/elysiajs/elysia/pull/440) query params with + sign did not get converted
- [#433](https://github.com/elysiajs/elysia/pull/433) remove crypto, unblock vite bundling, cloudflare worker support
- [#422](https://github.com/elysiajs/elysia/pull/422) add check for instanceof if constructor.name doesn't match

# 0.8.9 - 11 Jan 2024
Bug fix:
- macro panic

# 0.8.8. - 2 Jan 2024
Bug fix:
- Add TypeBox back to Bun bundle

# 0.8.7 - 1 Jan 2024
Improvement:
- [#385](https://github.com/elysiajs/elysia/issues/385) If error is instanceof Response, respond with it

Bug fix:
- onRequest doesn't early return
- handle thrown error function
- [#373](https://github.com/elysiajs/elysia/issues/373) cookie is not set when File is return
- [#379](https://github.com/elysiajs/elysia/issues/379) WebSocket: Sending a space character ' ' receives 0
- [#317](https://github.com/elysiajs/elysia/issues/317) Exclude TypeBox from bundling

# 0.8.6. - 29 Dec 2023
Bug fix:
- body without default value thrown Object.assign error

# 0.8.5. - 27 Dec 2023
Bug fix:
- Bun entry point

# 0.8.4. - 27 Dec 2023
Bug fix:
- macro caused an Object.entries cannot be undefined
- `mapResponse` and `afterHandle` missing decorators

# 0.8.3. - 23 Dec 2023
Bug fix:
- add early return on `isContextPassToFunction` for static content to prevent invalid regex

# 0.8.2 - 23 Dec 2023
Bug fix:
- `ctx.path` and `ctx.qi` is missing when using `onRequest`

# 0.8.1 - 23 Dec 2023
Bug fix:
- `be` is undefined when using `afterResponse` with `mapResponse`

# 0.8.0 - 23 Dec 2023
Feature:
- `headers` initialization function
- macro
- static content
- default property
- error function
- add stack trace to plugin checksum configurable by `config.analytic` (default to false)
- new life-cycle
    - `resolve`: derive after validation
    - `mapResponse`: custom response mapping

Improvement:
- lazy query reference
- add content-range header to `File` and `Blob` by default if etag is not used
- update TypeBox to 0.32
- override lifecycle response of `be` and `af`

Breaking Change:
- `afterHandle` no longer early return

Change:
- change validation response to JSON
- differentiate derive from `decorator['request']` as `decorator['derive']`
- `derive` now don't show infer type in onRequest

Bug fix:
- remove `headers`, `path` from `PreContext`
- remove `derive` from `PreContext`
- Elysia type doesn't output custom `error`
- `onStart` doesn't reflect server

# 0.7.31 - 9 Dec 2023
Improvement:
- [#345](https://github.com/elysiajs/elysia/pull/345) add font to `SchemaOptions`
- Update `@types/cookie` to `^0.6.0`

Bug fix:
- [#338](https://github.com/elysiajs/elysia/pull/338) guard sandbox did not inherit global config.
- [#330](https://github.com/elysiajs/elysia/pull/330) preserve query params for mounted handler
- [#332](https://github.com/elysiajs/elysia/pull/332) reexport TSchema from typebox
- [#319](https://github.com/elysiajs/elysia/pull/319) TypeBox Ref error when using Elysia.group()

# 0.7.30 - 5 Dec 2023
Bug fix:
- Emergency release override latest beta

# 0.7.29 - 19 Nov 2023
Bug fix:
- WebSocket params conflict with defined type
- Inherits status code on custom error

# 0.7.28 - 16 Nov 2023
Chore:
- Update `cookie` to `0.6.0`

Bug fix:
- [#314](https://github.com/elysiajs/elysia/pull/314) Unable to dereference schema with 'undefined' when using t.Ref

# 0.7.27 - 16 Nov 2023
Bug fix:
- [#312](https://github.com/elysiajs/elysia/issues/312) default params type suggestion for WebSocket
- [#310](https://github.com/elysiajs/elysia/issues/310) Preserve original hostname when using `.mount()`
- [#309](https://github.com/elysiajs/elysia/issues/309) t.RegExp doesn't work due to requiring default value
- [#308](https://github.com/elysiajs/elysia/issues/308) t.Numeric should not convert empty string to 0
- [#305](https://github.com/elysiajs/elysia/issues/305) Elysia({ scoped: true }) should still expose defined routes on type level
- [#304](https://github.com/elysiajs/elysia/issues/304) Using a hook/guard/schema with a handler function and request without body results in a "Unexpected end of JSON input"-error
- [#299](https://github.com/elysiajs/elysia/issues/299) Missing request.path parameter in .onRequest
- [#289](https://github.com/elysiajs/elysia/issues/289) Ability to localize TypeBox errors
- [#272](https://github.com/elysiajs/elysia/issues/272) onError handler has error property as undefined on Cloudflare Workers
- [#210](https://github.com/elysiajs/elysia/issues/210) t.Numeric not validating properly
- [#188](https://github.com/elysiajs/elysia/issues/188) Status codes of the error classes don't match the response through onError
- [#140](https://github.com/elysiajs/elysia/issues/140) plugin hierarchy messes up derive function in child plugin
- [#27](https://github.com/elysiajs/elysia/issues/27) Websocket definition in groups

# 0.7.26 - 15 Nov 2023
Bug fix:
- duplicated lifecycle event if using function plugin async

# 0.7.25 - 14 Nov 2023
Bug fix:
- Leaked type from `guard` callback and `group guard`

# 0.7.24 - 8 Nov 2023
Bug fix:
- add `ReadableStream` to response mapping to `mapResponse`

# 0.7.23 - 8 Nov 2023
Bug fix:
- Send `exit` status on early return with trace set

# 0.7.22 - 8 Nov 2023
Change:
- Rewrite `trace`

Bug fix:
- trace not awaiting multiple trace process
- trace hang on early `beforeHandle` return
- `afterHandle` with `trace.afterHandle` AoT cause duplicate value header

# 0.7.21 - 27 Oct 2023
Bug fix:
- [#281](https://github.com/elysiajs/elysia/pull/281) add cookie.remove options
- add `await traceDone` to early return

# 0.7.20 - 26 Oct 2023
Bug fix:
- `trace` is stuck when inherits to plugin

Improvement:
- add unit test for `mapCompactResponse`, `Passthrough`

# 0.7.19 - 25 Oct 2023
Bug fix:
- add `$passthrough` for `mapCompactResponse`

# 0.7.18 - 24 Oct 2023
Feature:
- add map handler for `ReadableStream`
- add `$passthrough` for custom property for response mapping

Bug fix:
- `.route` accept `string[]` instead of `string`

Change:
- remove `ElyEden`

# 0.7.17 - 15 Oct 2023
Feature:
- add `ElyEden`
- re-add `id` to websocket

Bug fix:
- [#255](https://github.com/elysiajs/elysia/issues/255) removeCookie sends HTTP-Header that is ignored by the Browser
- [#263](https://github.com/elysiajs/elysia/issues/263) http and websocket on same route
- [#269](https://github.com/elysiajs/elysia/pull/269) Correct handling of Buffer object

# 0.7.16 - 10 Oct 2023
Improvement:
- `t.Cookie` cookie option type
- [#253](https://github.com/elysiajs/elysia/pull/253) platform agnostic cookie
- Decorator like `state`, `decorate` and `derive`, doesn't apply to WebSocket `data`
- re-export `Static` from

# 0.7.15 - 26 Sep 2023
Change:
- Update TypeBox to 0.31.17
- [#218](https://github.com/elysiajs/elysia/pull/218) Fix [#213](https://github.com/elysiajs/elysia/pull/213) prepend async redefined routes (partial fix)
- Using set `onRequest` doesn't set headers and status on empty error handler

# 0.7.14 - 26 Sep 2023
Bug fix:
- Make `t.Files` parameter optional
- model remap now using `TSchema` instead of literal type for creating type abstraction

# 0.7.13 - 25 Sep 2023
Improvement:
- Using listener instead of microtick to handle `trace.set`
- Set default cookie path to '/'

Bug fix:
- Duplicate group path when hook is provided

# 0.7.12 - 23 Sep 2023
Bug fix:
- Handle cookie expire time
- Set default value of config.cookie.path to '/'

# 0.7.11 - 23 Sep 2023
Improvement:
- Skip cookie validation if schema is empty object

Bug fix:
- Accept cookie property from constructor when schema is not defined

# 0.7.10 - 23 Sep 2023
Bug fix:
- handle FFI object in deepMerge, fix Prisma

# 0.7.9 - 23 Sep 2023
Bug fix:
- async instance cause config to be undefined

# 0.7.8 - 23 Sep 2023
Bug fix:
- async instance cause type conflict

# 0.7.7 - 22 Sep 2023
Bug fix:
- [#210](https://github.com/elysiajs/elysia/issues/210) `t.Numeric` allowing plain `String`
- `t.ObjectString` allowing plain `String`
- [#209](https://github.com/elysiajs/elysia/issues/209) `t.MaybeEmpty` tolerate `null` and `undefined`
- [#205](https://github.com/elysiajs/elysia/issues/205) WebSocket routes not working in plugins
- [#195](https://github.com/elysiajs/elysia/pull/195), [#201](https://github.com/elysiajs/elysia/pull/201) allow WebSocket destructuring

# 0.7.6 - 21 Sep 2023
Bug fix:
- Separate return type by status

# 0.7.5 - 21 Sep 2023
Bug fix:
- inject derive to `GraceHandler`

# 0.7.4 - 21 Sep 2023
Bug fix:
- check for class-like object
- add `GraceHandler` to access both `app` and `context`

# 0.7.3 - 21 Sep 2023
Bug fix:
- resolve 200 by default when type is not provided

# 0.7.2 - 20 Sep 2023
Bug fix:
- decorator and store is resolved as `undefined` in `onError` hook
- deepMerge with Module object
- Retain comment in `.d.ts`

# 0.7.1 - 20 Sep 2023
Bug Fix:
- Class property is removed when calling deepMerge

# 0.7.0 - 20 Sep 2023
Feature:
- rewrite type
- rewrite Web Socket
- add mapper method
- add affix, prefix, suffix
- trace
- typeBox.Transfom
- rewrite Type.ElysiaMeta to use TypeBox.Transform
- new type:
    - t.Cookie
    - t.ObjectString
    - t.MaybeEmpty
    - t.Nullable
- add `Context` to `onError`
- lifecycle hook now accept array function
- true encapsulation scope

Improvement:
- static Code Analysis now support rest parameter
- breakdown dynamic router into single pipeline instead of inlining to static router to reduce memory usage
- set `t.File` and `t.Files` to `File` instead of `Blob`
- skip class instance merging
- handle `UnknownContextPassToFunction`
- [#157](https://github.com/elysiajs/elysia/pull/179) WebSocket - added unit tests and fixed example & api by @bogeychan
- [#179](https://github.com/elysiajs/elysia/pull/179) add github action to run bun test by @arthurfiorette

Breaking Change:
- remove `ws` plugin, migrate to core
- rename `addError` to `error`

Change:
- using single findDynamicRoute instead of inlining to static map
- remove `mergician`
- remove array routes due to problem with TypeScript

Bug fix:
- strictly validate response by default
- `t.Numeric` not working on headers / query / params
- `t.Optional(t.Object({ [name]: t.Numeric }))` causing error
- add null check before converting `Numeric`
- inherits store to instance plugin
- handle class overlapping
- [#187](https://github.com/elysiajs/elysia/pull/187) InternalServerError message fixed to "INTERNAL_SERVER_ERROR" instead of "NOT_FOUND" by @bogeychan
- [#167](https://github.com/elysiajs/elysia/pull/167) mapEarlyResponse with aot on after handle

# 0.6.24 - 18 Sep 2023
Feature:
- [#149](https://github.com/elysiajs/elysia/pulls/149) support additional status codes in redirects

Improvement:
- [#157](https://github.com/elysiajs/elysia/pulls/157) added unit tests and fixed example & api

Bug fix:
- [#167](https://github.com/elysiajs/elysia/pulls/167) mapEarlyResponse with aot on after handle
- [#160](https://github.com/elysiajs/elysia/pulls/160) typo in test suite name
- [#152](https://github.com/elysiajs/elysia/pulls/152) bad code in Internal server error class

# 0.6.23 - 12 Sep 2023
Bug fix:
- Maximum callstack for duplicated deep class / object
- [#121](https://github.com/elysiajs/elysia/issues/121) Cannot use PrismaClient in .decorate or .state

# 0.6.22 - 11 Sep 2023
Bug fix:
- Remove `const` and `RemoveDeepWritable` from decorate to allow function call

# 0.6.21 - 10 Sep 2023
Feature:
- [#112](https://github.com/elysiajs/elysia/issues/112) Route arrays

# 0.6.20 - 9 Sep 2023
Bug fix:
- [#107](https://github.com/elysiajs/elysia/issues/107) Elysia handler local hooks not recognizing registered errors on app instance

# 0.6.19 - 7 Sep 2023
Bug fix:
- Inherits state and error from plugin instance

# 0.6.18 - 5 Sep 2023
Improvement:
- Automatically parse File to `Files` if set

# 0.6.17 - 4 Sep 2023
Bug fix:
- [#98](https://github.com/elysiajs/elysia/issues/98) Add context.set.cookie to accept array of string
- [#92](https://github.com/elysiajs/elysia/pull/92) WebSocket beforeHandle unable to access plugins / state / derive's

# 0.6.16 - 1 Sep 2023
Bug fix:
- inherits `onError` lifecycle from plugin instance

# 0.6.15 - 31 Aug 2023
Bug fix:
- inherits `set` if `Response` is returned

# 0.6.14 - 28 Aug 2023
Bug fix:
- deduplicate plugin via global model
- duplicated life-cycle
- top-down plugin deduplication
- plugin life-cycle leak on new model
- add `Elysia.scope` to contain lifecycle, store, and decorators

# 0.6.13 - 28 Aug 2023
Bug fix:
- make this.server.reload optional to make Node compatability work
- duplicate path name when using prefix config with group
- don't filter local event inside new plugin model group
- Remove post.handler in return

# 0.6.12 - 26 Aug 2023
Bug fix:
- Make this.server.reload optional to make Node compatability work

# 0.6.11 - 16 Aug 2023
Bug fix:
- [#86](https://github.com/elysiajs/elysia/issues/86) Group prefix repeating on inline function callback
- [#88](https://github.com/elysiajs/elysia/issues/88), onResponse hooks validation return non 400

# 0.6.10 - 13 Aug 2023
Bug fix:
- Query is set to pathname when ? not presented in dynamic mode

# 0.6.9 - 11 Aug 2023
Bug fix:
- Derive not working on dynamic mode

# 0.6.8 - 11 Aug 2023
Bug fix:
- append routes on dynamic mode

# 0.6.7 - 11 Aug 2023
Bug fix:
- use: Plugin type inference

# 0.6.6 - 11 Aug 2023
Bug fix:
- Collide Elysia.prefix on other methods

# 0.6.5 - 11 Aug 2023
Bug fix:
- Collide Elysia.prefix type

# 0.6.4 - 11 Aug 2023
Bug fix:
- Collide Elysia.prefix type
- Add skip group with prefix instance see [#85](https://github.com/elysiajs/elysia/pull/85)

# 0.6.3 - 8 Aug 2023
Bug fix:
- resolve .code and [ERROR_CODE]

# 0.6.2 - 8 Aug 2023
Change:
- Add **ErrorCode** symbol

Bug fix:
- Inline guard hook
- Error code not handled
- Set default query to {} when presented

# 0.6.1 - 6 Aug 2023
Improvement:
- Drop usage of `node:process` to support Cloudflare Worker

# 0.6.0 - 6 Aug 2023
Feature:
- Introducing Dynamic Mode (aot: false)
- Introducing `.mount`
- Introducing `.error` for handling Strict Error Type
- Plugin checksum for plugin deduplication
- Add `.onResponse`

Improvement:
- TypeBox 0.30
- AfterHandle now automatically maps the value
- Using Bun Build for targeting Bun
- Support Cloudflare worker with Dynamic Mode (and ENV)

Change:
- Moved registerSchemaPath to @elysiajs/swagger

# 0.6.0-alpha.4
Feature:
- Add `addError` to declaratively add Error to scope
- Add `afterHandle` now can return a literal value instead of limited to only `Response`

# 0.6.0-alpha.3 - 29 Jul 2023
Feature:
- Introduce `.mount`
- Add dynamic mode for TypeBox
- Add $elysiaChecksum to deduplicate lifecycle event
- Add $elysiaHookType to differentiate between global and local hook in `use`

Fix:
- Deduplication of plugin's lifecycle (see $elysiaHookType)

Change:
- Using Bun Build for target Bun

Breaking Change:
- [Internal] refactored `getSchemaValidator`, `getResponseSchemaValidator` to named parameters
- [Internal] moved `registerSchemaPath` to `@elysiajs/swagger`

# 0.6.0-alpha.2
Feature:
- [Internal] Add qi (queryIndex) to context
- Add `error` field to Elysia type system for adding custom error message

# 0.6.0-alpha.1
Feature:
- [Internal] Add support for accessing composedHandler via routes

# 0.6.0-alpha.0
Feature:
- Dynamic mode for Cloudflare Worker
- Support for registering custom error code
- Using `loosePath` (by default), and add `config.strictPath
- Support for setting basePath
- Recursive path typing

Improvement:
- Slighty improve type checking speed

Bug Fix:
- recursive schema collision causing infinite type

Breaking Change:
- Remove Elysia Symbol (Internal)

# 0.5.25 - 25 Jul 2023
Bug fix:
- ws resolve type to undefined instead of unknown cause unexpected type mismatched when not provided

# 0.5.24 - 22 Jul 2023
Bug fix:
- [#68](https://github.com/elysiajs/elysia/issues/68) invalid path params when using numeric

# 0.5.23 - 20 Jul 2023
Bug fix:
- [#68](https://github.com/elysiajs/elysia/issues/68) invalid optional query params when using numeric

# 0.5.22 - 9 Jul 2023
Bug fix:
- update onAfterHandle to be Response only

# 0.5.20 - 23 Jun 2023
Bug fix:
- async fn on Static Code Analysis

# 0.5.19 - 19 Jun 2023
Bug fix:
- optimize `ws` plugin type

# 0.5.18 - 11 Jun 2023
Bug fix:
- `mapEarlyResponse` is missing on request

# 0.5.17 - 7 Jun 2023
Improvement:
- Respect explicit body type first
- `mapCompactResponse` on `null` or `undefined` type

Bug fix:
- Mapped unioned type on Static Code Analysis
- `form` is `undefined` when using parsing `formData`

# 0.5.16 - 5 Jun 2023
Improvement:
- Respect inner scope of lifecycle first
- Add type support for local `afterHandle`

Bug fix:
- `onAfterHandler` cause response to mutate on void

# 0.5.15 - 4 Jun 2023
Improvement:
- Map CommonJS module in package.json

# 0.5.14 - 4 June 2023
Improvement:
- Using tsc to compile CommonJS instead of SWC to support `module.exports` syntax

# 0.5.13 - 4 June 2023
Bug fix:
- Add loosen type for onError's code for defying custom error status

# 0.5.12 - 3 June 2023
Bug fix:
- Multiple onRequest cause error

# 0.5.11 - 31 May 2023
Improvement:
- Experimental basic support for Static Code Analysis in Nodejs

# 0.5.10 - 31 May 2023
Bug fix:
- h is undefined when using headers in Node environment
- Update Memoirist to 0.1.4 to support full CommonJS

# 0.5.9 - 30 May 2023
Improvement:
- Add content-type support for 'none', 'arrayBuffer' / 'application/octet-stream'
- Add type support type registration of wildcard params
- Add support for 'config.basePath'

# 0.5.8 - 27 May 2023
Improvement:
- Add support for returning a class instance

# 0.5.7 - 25 May 2023
Bug fix:
- Bun is undefined on other runtime

# 0.5.6 - 25 May 2023
Improvement:
- Using `new Response` instead of factory `Response.json`

# 0.5.5 - 25 May 2023
Improvement:
- Using request.json() to handle application/json body instead of JSON.parse(await c.text())

# 0.5.4 - 25 May 2023
Improvement:
- Add Static Code Analysis for conditional try-catch
- Reduce usage of method to accessor

# 0.5.3 - 22 May 2023
Improvement:
- Add `mapCompactResponse` for static code analysis
- Using `constructor.name` to inline object mapping
- Using single assignment for URL destructuring
- Using default map for dynamic route to remove static map label and break

Bug fix:
- Web Socket context.headers is empty [Elysia#46](https://github.com/elysiajs/elysia/issues/46)

# 0.5.2 - 16 May 2023
Improvement:
- Static Code Analysis for fallback route

Bug fix:
- Remove constant generic from `state` to be mutable

# 0.5.1 - 16 May 2023
Bug fix:
- Syntax error if multiple numeric type is set
- Prevent fallthrough behavior of switch map

# 0.5.0 - 15 May 2023
Improvement:
- Add CommonJS support for running Elysia with Node adapter
- Remove manual fragment mapping to speed up path extraction
- Inline validator in `composeHandler` to improve performance
- Use one time context assignment
- Add support for lazy context injection via Static Code Analysis
- Ensure response non nullability
- Add unioned body validator check
- Set default object handler to inherits
- Using `constructor.name` mapping instead of `instanceof` to improve speed
- Add dedicated error constructor to improve performance
- Conditional literal fn for checking onRequest iteration
- improve WebSocket type

Bug fix:
- Possible

Breaking Change:
- Rename `innerHandle` to `fetch`
    - to migrate: rename `.innerHandle` to `fetch`
- Rename `.setModel` to `.model`
    - to migrate: rename `setModel` to `model`
- Remove `hook.schema` to `hook`
    - to migrate: remove schema and curly brace `schema.type`:
    ```ts
    // from
    app.post('/', ({ body }) => body, {
        schema: {
            body: t.Object({
                username: t.String()
            })
        }
    })

    // to
    app.post('/', ({ body }) => body, {
        body: t.Object({
            username: t.String()
        })
    })
    ```
- remove `mapPathnameRegex` (internal)

# 0.5.0-beta.8 - 15 May 2023
Bug fix:
- it recompile on async

# 0.5.0-beta.7 15 May 2023
Bug fix:
- detect promise on parse
- using swc to compile to commonjs

# 0.5.0-beta.6 - 15 May 2023
Improvement:
- Improve merge schema type

# 0.5.0-beta.5 - 15 May 2023
Bug fix:
- Add support for ALL method for dynamic path
- Add support for parser in pre-compiled body

# 0.5.0-beta.4 - 15 May 2023
Bug fix:
- Use Memoirist instead of Raikiri in ws

# 0.5.0-beta.3 - 15 May 2023
Improvement:
- Static Code Analysis on derive

# 0.5.0-beta.2 - 14 May 2023
Improvement:
- Re-compile on lazy modules

# 0.5.0-beta.1 - 14 May 2023
Improvement:
- Merge nested schema type

# 0.4.14 - 2 May 2023
Fix:
- set default object handler to inherits

# 0.4.13 - 28 Apr 2023
Fix:
- emergency override experimental version

# 0.4.12 - 26 Apr 2023
Fix:
- CatchResponse to return 200 status code by default when using Eden Treaty

# 0.4.11 - 26 Apr 2023
Fix:
- response schema doesn't unwrap response type

# 0.4.10 - 25 Apr 2023
Fix:
- Update Raikiri stability

# 0.4.9 - 21 Apr 2023
Improvement:
- Add support for `parse` in websocket [#33](https://github.com/elysiajs/elysia/pull/33)

Fix:
- Inherits out-of-order `onError` life cycle in nested group
- Update Raikiri to 0.1.2 to handle mangled part

# 0.4.8 - 18 Apr 2023
Fix:
- Fix LocalHandler doesn't check single type response

# 0.4.7 - 18 Apr 2023
Improvement:
- Update Raikiri to ^1.1.0

# 0.4.6 - 10 Apr 2023
Improvement:
- perf: add static route main class
- perf: reduce `ComposedHandler` to function instead of nested object

Fix:
- `group` and `guard` shouldn't decorate a request on type-level (acceptable on run-time level for shared memory)

# 0.4.5 - 6 Apr 2023
Fix:
- Using default value check for `set.status` instead truthy value

# 0.4.4 - 6 Apr 2023
Improvement:
- using `isNotEmpty` for `mapResponse`
- pre check if `set.headers['Set-Cookie']` is array before converting to headers
- using `mapPathnameAndQueryRegEx.exec(request.url)` instead of `request.url.match(mapPathnameAndQueryRegEx)`

# 0.4.3 - 31 Mar 2023
Fix:
- Scoped decorators

# 0.4.2 - 31 Mar 2023
Improvement:
- Use constructor name for faster handler matching
- Map Promise

# 0.4.1 - 31 Mar 2023
Fix:
- remove type module from package.json

# 0.4.0 - 30 Mar 2023
Feature:
- Ahead of Time compilation
- TypeBox 0.26
- Validate response per status instead of union
- Add `if` for conditional route
- Custom Validation Error

Improvement:
- Update TypeBox to 0.26.8
- Inline a declaration for response type
- Refactor some type for faster response
- Use Typebox `Error().First()` instead of iteration
- Add `innerHandle` for returning an actual response (for benchmark)

Breaking Change:
- Separate `.fn` to `@elysiajs/fn`

# 0.3.2 - 26 Mar 2023
Fix:
- child to inhertis WebSocket plugin (https://github.com/elysiajs/elysia/issues/27)
- multiple status response does not work with the group (https://github.com/elysiajs/elysia/issues/28)

# 0.3.1 - 17 Mar 2023
Fix:
- Wildcard fallback of Raikiri

# 0.3.0 - 17 Mar 2023
Feature:
- Elysia Fn
- Suport `multipart/form-data`
- `t.File` and `t.Files` for file validation
- `schema.content` for specifying content type

Improvement:
- Add string format: 'email', 'uuid', 'date', 'date-time'
- Update @sinclair/typebox to 0.25.24
- Update Raikiri to 0.2.0-beta.0 (ei)
- Add file upload test thanks to #21 (@amirrezamahyari)
- Pre compile lowercase method for Eden
- Reduce complex instruction for most Elysia types
- Change store type to `unknown`
- Compile `ElysiaRoute` type to literal
- Optimize type compliation, type inference and auto-completion
- Improve type compilation speed
- Improve TypeScript inference between plugin registration
- Optimize TypeScript inference size
- Context creation optimization
- Use Raikiri router by default
- Remove unused function
- Refactor `registerSchemaPath` to support OpenAPI 3.0.3
- Add `error` inference for Eden
- Mark `@sinclair/typebox` as optional `peerDenpendencies`

Fix:
- Raikiri 0.2 thrown error on not found
- Union response with `t.File` is not working
- Definitions isn't defined on Swagger
- details are missing on group plugin
- group plugin, isn't unable to compile schema
- group is not exportable because EXPOSED is a private property
- Multiple cookies doesn't set `content-type` to `application/json`
- `EXPOSED` is not export when using `fn.permission`
- Missing merged return type for `.ws`
- Missing nanoid
- context side-effects
- `t.Files` in swagger is referring to single file
- Eden response type is unknown
- Unable to type `setModel` inference definition via Eden
- Handle error thrown in non permission function
- Exported variable has or is using name 'SCHEMA' from external module
- Exported variable has or is using name 'DEFS' from external module
- Possible errors for building Elysia app with `declaration: true` in `tsconfig.json`

Breaking Change:
- Rename `inject` to `derive`
- Depreacate `ElysiaRoute`, changed to inline
- Remove `derive`
- Update from OpenAPI 2.x to OpenAPI 3.0.3
- Move context.store[SYMBOL] to meta[SYMBOL]

# 0.3.0-rc.9 - 16 Mar 2023
Improvement:
- Add string format: 'email', 'uuid', 'date', 'date-time'

# 0.3.0-rc.8 - 16 Mar 2023
Fix:
- Raikiri 0.2 thrown error on not found

# 0.3.0-rc.7 - 16 Mar 2023
Improvement:
- Update @sinclair/typebox to 0.25.24
- Update Raikiri to 0.2.0-beta.0 (ei)
- Add file upload test thanks to #21 (@amirrezamahyari)

# 0.3.0-rc.6 - 10 Mar 2023
Fix:
- Union response with `t.File` is not working

# 0.3.0-rc.5 - 10 Mar 2023
Fix:
- Definitions isn't defined on Swagger
- details are missing on group plugin
- group plugin, isn't unable to compile schema
- group is not exportable because EXPOSED is a private property

# 0.3.0-rc.4 - 9 Mar 2023
Fix:
- console.log while using cookie

# 0.3.0-rc.3 - 9 Mar 2023
Breaking Change:
- Rename `inject` to `derive`

Fix:
- Multiple cookies doesn't set `content-type` to `application/json`
- `EXPOSED` is not export when using `fn.permission`

# 0.3.0-rc.2 - 7 Mar 2023
Fix:
- Missing merged return type for `.ws`

# 0.3.0-rc.1 - 7 Mar 2023
Fix:
- Missing nanoid

# 0.3.0-beta.6 - 4 Mar 2023
Fix:
- context side-effects

# 0.3.0-beta.5 - 1 Mar 2023
Improvement:
- Pre compile lowercase method for Eden

# 0.3.0-beta.3 - 27 Feb 2023
Improvement:
- ~33% faster for compiling type inference
- Reduce complex instruction for most Elysia types
- Change store type to `unknown`

Fix:
- `t.Files` in swagger is referring to single file
- Eden response type is unknown

# 0.3.0-beta.2 - 27 Feb 2023
Improvement:
- Compile `ElysiaRoute` type to literal
- Optimize type compliation, type inference and auto-completion
- Improve type compilation speed by ~3x

Fix:
- Unable to type `setModel` inference definition via Eden

Breaking Change:
- Depreacate `ElysiaRoute`, changed to inline

# 0.3.0-beta.1 - 25 Feb 2023
Fix:
- Handle error thrown in non permission function

# 0.3.0-beta.0 - 25 Feb 2023
Feature:
- Elysia Fn
- Suport `multipart/form-data`
- `t.File` and `t.Files` for file validation
- `schema.content` for specifying content type

Improvement:
- Improve TypeScript inference between plugin registration
- Optimize TypeScript inference size
- Context creation optimization
- Use Raikiri router by default
- Remove unused function
- Refactor `registerSchemaPath` to support OpenAPI 3.0.3
- Add `error` inference for Eden
- Mark `@sinclair/typebox` as optional `peerDenpendencies`

Fix:
- Exported variable has or is using name 'SCHEMA' from external module
- Exported variable has or is using name 'DEFS' from external module
- Possible errors for building Elysia app with `declaration: true` in `tsconfig.json`

Breaking Change:
- Remove `derive`
- Update from OpenAPI 2.x to OpenAPI 3.0.3
- Move context.store[SYMBOL] to meta[SYMBOL]

# 0.2.9 - 20 Feb 2023
Bug fix:
- `group` doesn't inherits `onError`

# 0.2.8 - 20 Feb 2023
Bug fix:
- `group` doesn't inherits `onError`

# 0.2.7 - 15 Feb 2023
Improvement:
- Remove `bind(this)`

# 0.2.6 - 10 Feb 2023
Feature:
- Add supports for multiple cookie

# 0.2.5 - 1 Feb 2023
Improvement:
- Minor optimization

# 0.2.4 - 1 Feb 2023
Improvement:
- Using SWC to bundle and minification
- Minor optimization

# 0.2.3 - 30 Jan 2023
Improvement:
- Update Raikiri to 0.0.0-beta.4

Change:
- Remove strictPath option and enabled by default

# 0.2.2 - 30 Jan 2023
Improvement:
- Migrate from @medley/router to Raikiri
- Minor optimization

# 0.2.0-rc.1 - 24 Jan 2023
Improvement:
- Map OpenAPI's schema detail on response
- Fix Type instantiation is excessively deep and possibly infinite
- Improve TypeScript inference time by removing recursive type in generic
- Inferred body is never instead of unknown

# 0.2.0-rc.0 - 23 Jan 2023
Feature:
- Add support for reference model via `.model`
- Add support for OpenAPI's `definitions` field

# 0.2.0-beta.2 - 22 Jan 2023
Feature:
- Add support for custom openapi field using `schema.detail`
- Add support for custom code for `response`

Improvement:
- Unioned status type for response
- Optimize TypeScript inference performance

# 0.2.0-beta.1 - 22 Jan 2023
Breaking Change:
- `onParse` now accepts `(context: PreContext, contentType: string)` instead of `(request: Request, contentType: string)`
    - To migrate, add `.request` to context to access `Request`

Feature:
- `onRequest` and `onParse` now can access `PreContext`
- Support `application/x-www-form-urlencoded` by default

Improvement:
- body parser now parse `content-type` with extra attribute eg. `application/json;charset=utf-8`

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
Introducing [Eden](https://elysiajs.com/plugins/eden.html), a fully type-safe client for Elysia server like tRPC.

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
- `getSchemaValidator` now infer output type to be reusable with `@kingworldjs/trpc`

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

Feature:
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
Feature:
- Add `config.strictPath` for handling strict path

# 0.0.0-experimental.26 - 10 Sep 2022
Improvement:
- Improve `clone` performance
- Inline `ref` value
- Using object to store internal route

Bug fix:
- 404 on absolute path

# 0.0.0-experimental.25 - 9 Sep 2022
Feature:
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
Feature:
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
