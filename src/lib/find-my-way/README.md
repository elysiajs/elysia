# find-my-way

[![js-standard-style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat)](http://standardjs.com/)  ![Node CI](https://github.com/delvedor/find-my-way/workflows/Node%20CI/badge.svg) [![NPM downloads](https://img.shields.io/npm/dm/find-my-way.svg?style=flat)](https://www.npmjs.com/package/find-my-way)

A crazy fast HTTP router, internally uses an highly performant [Radix Tree](https://en.wikipedia.org/wiki/Radix_tree) (aka compact [Prefix Tree](https://en.wikipedia.org/wiki/Trie)), supports route params, wildcards, and it's framework independent.

If you want to see a benchmark comparison with the most commonly used routers, see [here](https://github.com/delvedor/router-benchmark).<br>
Do you need a real-world example that uses this router? Check out [Fastify](https://github.com/fastify/fastify) or [Restify](https://github.com/restify/node-restify).

<a name="install"></a>
## Install
```
npm i find-my-way --save
```

<a name="usage"></a>
## Usage
```js
const http = require('http')
const router = require('find-my-way')()

router.on('GET', '/', (req, res, params) => {
  res.end('{"message":"hello world"}')
})

const server = http.createServer((req, res) => {
  router.lookup(req, res)
})

server.listen(3000, err => {
  if (err) throw err
  console.log('Server listening on: http://localhost:3000')
})
```

<a name="api"></a>
## API
<a name="constructor"></a>
#### FindMyWay([options])
Instance a new router.<br>
You can pass a default route with the option `defaultRoute`.
```js
const router = require('find-my-way')({
  defaultRoute: (req, res) => {
    res.statusCode = 404
    res.end()
  }
})
```

In case of a badly formatted url *(eg: `/hello/%world`)*, by default `find-my-way` will invoke the `defaultRoute`, unless you specify the `onBadUrl` option:
```js
const router = require('find-my-way')({
  onBadUrl: (path, req, res) => {
    res.statusCode = 400
    res.end(`Bad path: ${path}`)
  }
})
```

Trailing slashes can be ignored by supplying the `ignoreTrailingSlash` option:
```js
const router = require('find-my-way')({
  ignoreTrailingSlash: true
})
function handler (req, res, params) {
  res.end('foo')
}
// maps "/foo/" and "/foo" to `handler`
router.on('GET', '/foo/', handler)
```

Duplicate slashes can be ignored by supplying the `ignoreDuplicateSlashes` option:
```js
const router = require('find-my-way')({
  ignoreDuplicateSlashes: true
})
function handler (req, res, params) {
  res.end('foo')
}
// maps "/foo", "//foo", "///foo", etc to `handler`
router.on('GET', '////foo', handler)
```

Note that when `ignoreTrailingSlash` and `ignoreDuplicateSlashes` are both set to true, duplicate slashes will first be removed and then trailing slashes will, meaning `//a//b//c//` will be converted to `/a/b/c`.

You can set a custom length for parameters in parametric *(standard, regex and multi)* routes by using `maxParamLength` option, the default value is 100 characters.<br/>
*If the maximum length limit is reached, the default route will be invoked.*
```js
const router = require('find-my-way')({
  maxParamLength: 500
})
```

If you are using a regex based route, `find-my-way` will throw an error if detects potentially catastrophic exponential-time regular expressions *(internally uses [`safe-regex2`](https://github.com/fastify/safe-regex2))*.<br/>
If you want to disable this behavior, pass the option `allowUnsafeRegex`.
```js
const router = require('find-my-way')({
  allowUnsafeRegex: true
})
```

According to [RFC3986](https://tools.ietf.org/html/rfc3986#section-6.2.2.1), find-my-way is case sensitive by default.
You can disable this by setting the `caseSensitive` option to `false`:
in that case, all paths will be matched as lowercase, but the route parameters or wildcards will maintain their original letter casing. You can turn off case sensitivity with:

```js
const router = require('find-my-way')({
  caseSensitive: false
})
```

The default query string parser that find-my-way uses is the Node.js's core querystring module. You can change this default setting by passing the option querystringParser and use a custom one, such as [qs](https://www.npmjs.com/package/qs).

```js
const qs = require('qs')
const router = require('find-my-way')({
  querystringParser: str => qs.parse(str)
})

router.on('GET', '/', (req, res, params, store, searchParams) => {
  assert.equal(searchParams, { foo: 'bar', baz: 'faz' })
})

router.lookup({ method: 'GET', url: '/?foo=bar&baz=faz' }, null)
```

You can assign a `buildPrettyMeta` function to sanitize a route's `store` object to use with the `prettyPrint` functions. This function should accept a single object and return an object.

```js

const privateKey = new Symbol('private key')
const store = { token: '12345', [privateKey]: 'private value' }

const router = require('find-my-way')({
  buildPrettyMeta: route => {
    const cleanMeta = Object.assign({}, route.store)

    // remove private properties
    Object.keys(cleanMeta).forEach(k => {
      if (typeof k === 'symbol') delete cleanMeta[k]
    })

    return cleanMeta // this will show up in the pretty print output!
  }
})

store[privateKey] = 'private value'
router.on('GET', '/hello_world', (req, res) => {}, store)

router.prettyPrint()

//└── / (-)
//    └── hello_world (GET)
//        • (token) "12345"

```

## Constraints

`find-my-way` supports restricting handlers to only match certain requests for the same path. This can be used to support different versions of the same route that conform to a [semver](#semver) based versioning strategy, or restricting some routes to only be available on hosts. `find-my-way` has the semver based versioning strategy and a regex based hostname constraint strategy built in.

To constrain a route to only match sometimes, pass `constraints` to the route options when registering the route:

```js
findMyWay.on('GET', '/', { constraints: { version: '1.0.2' } }, (req, res) => {
  // will only run when the request's Accept-Version header asks for a version semver compatible with 1.0.2, like 1.x, or 1.0.x.
})

findMyWay.on('GET', '/', { constraints: { host: 'example.com' } }, (req, res) => {
  // will only run when the request's Host header is `example.com`
})
```

Constraints can be combined, and route handlers will only match if __all__ of the constraints for the handler match the request. `find-my-way` does a boolean AND with each route constraint, not an OR.

`find-my-way` will try to match the most constrained handlers first before handler with fewer or no constraints.

<a name="custom-constraint-strategies"></a>
### Custom Constraint Strategies

Custom constraining strategies can be added and are matched against incoming requests while trying to maintain `find-my-way`'s high performance. To register a new type of constraint, you must add a new constraint strategy that knows how to match values to handlers, and that knows how to get the constraint value from a request. Register strategies when constructing a router or use the addConstraintStrategy method.

Add a custom constrain strategy when constructing a router:

```js
const customResponseTypeStrategy = {
  // strategy name for referencing in the route handler `constraints` options
  name: 'accept',
  // storage factory for storing routes in the find-my-way route tree
  storage: function () {
    let handlers = {}
    return {
      get: (type) => { return handlers[type] || null },
      set: (type, store) => { handlers[type] = store }
    }
  },
  // function to get the value of the constraint from each incoming request
  deriveConstraint: (req, ctx) => {
    return req.headers['accept']
  },
  // optional flag marking if handlers without constraints can match requests that have a value for this constraint
  mustMatchWhenDerived: true
}

const router = FindMyWay({ constraints: { accept: customResponseTypeStrategy } });
```

Add a custom constraint strategy using the addConstraintStrategy method:

```js
const customResponseTypeStrategy = {
  // strategy name for referencing in the route handler `constraints` options
  name: 'accept',
  // storage factory for storing routes in the find-my-way route tree
  storage: function () {
    let handlers = {}
    return {
      get: (type) => { return handlers[type] || null },
      set: (type, store) => { handlers[type] = store }
    }
  },
  // function to get the value of the constraint from each incoming request
  deriveConstraint: (req, ctx) => {
    return req.headers['accept']
  },
  // optional flag marking if handlers without constraints can match requests that have a value for this constraint
  mustMatchWhenDerived: true
}

const router = FindMyWay();
router.addConstraintStrategy(customResponseTypeStrategy);
```

Once a custom constraint strategy is registered, routes can be added that are constrained using it:


```js
findMyWay.on('GET', '/', { constraints: { accept: 'application/fancy+json' } }, (req, res) => {
  // will only run when the request's Accept header asks for 'application/fancy+json'
})

findMyWay.on('GET', '/', { constraints: { accept: 'application/fancy+xml' } }, (req, res) => {
  // will only run when the request's Accept header asks for 'application/fancy+xml'
})
```

Constraint strategies should be careful to make the `deriveConstraint` function performant as it is run for every request matched by the router. See the `lib/strategies` directory for examples of the built in constraint strategies.


<a name="custom-versioning"></a>
By default, `find-my-way` uses a built in strategies for the version constraint that uses semantic version based matching logic, which is detailed [below](#semver). It is possible to define an alternative strategy:

```js
const customVersioning = {
  // replace the built in version strategy
  name: 'version',
  // provide a storage factory to store handlers in a simple way
  storage: function () {
    let versions = {}
    return {
      get: (version) => { return versions[version] || null },
      set: (version, store) => { versions[version] = store }
    }
  },
  deriveConstraint: (req, ctx) => {
    return req.headers['accept']
  },
  mustMatchWhenDerived: true // if the request is asking for a version, don't match un-version-constrained handlers
}

const router = FindMyWay({ constraints: { version: customVersioning } });
```

The custom strategy object should contain next properties:
* `storage` - a factory function to store lists of handlers for each possible constraint value. The storage object can use domain-specific storage mechanisms to store handlers in a way that makes sense for the constraint at hand. See `lib/strategies` for examples, like the `version` constraint strategy that matches using semantic versions, or the `host` strategy that allows both exact and regex host constraints.
* `deriveConstraint` - the function to determine the value of this constraint given a request

The signature of the functions and objects must match the one from the example above.

*Please, be aware, if you use your own constraining strategy - you use it on your own risk. This can lead both to the performance degradation and bugs which are not related to `find-my-way` itself!*

<a name="on"></a>
#### on(method, path, [opts], handler, [store])
Register a new route.
```js
router.on('GET', '/example', (req, res, params, store, searchParams) => {
  // your code
})
```
Last argument, `store` is used to pass an object that you can access later inside the handler function. If needed, `store` can be updated.
```js
router.on('GET', '/example', (req, res, params, store) => {
  assert.equal(store, { message: 'hello world' })
}, { message: 'hello world' })
```

##### Versioned routes

If needed, you can provide a `version` route constraint, which will allow you to declare multiple versions of the same route that are used selectively when requests ask for different version using the `Accept-Version` header. This is useful if you want to support several different behaviours for a given route and different clients select among them.

If you never configure a versioned route, the `'Accept-Version'` header will be ignored. Remember to set a [Vary](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Vary) header in your responses with the value you are using for defining the versioning (e.g.: 'Accept-Version'), to prevent cache poisoning attacks. You can also configure this as part your Proxy/CDN.

###### default
<a name="semver"></a>
The default versioning strategy follows the [semver](https://semver.org/) specification. When using `lookup`, `find-my-way` will automatically detect the `Accept-Version` header and route the request accordingly. Internally `find-my-way` uses the [`semver-store`](https://github.com/delvedor/semver-store) to get the correct version of the route; *advanced ranges* and *pre-releases* currently are not supported.

*Be aware that using this feature will cause a degradation of the overall performances of the router.*

```js
router.on('GET', '/example', { constraints: { version: '1.2.0' }}, (req, res, params) => {
  res.end('Hello from 1.2.0!')
})

router.on('GET', '/example', { constraints: { version: '2.4.0' }}, (req, res, params) => {
  res.end('Hello from 2.4.0!')
})

// The 'Accept-Version' header could be '1.2.0' as well as '*', '2.x' or '2.4.x'
```

If you declare multiple versions with the same *major* or *minor* `find-my-way` will always choose the highest compatible with the `Accept-Version` header value.

###### custom
It's also possible to define a [custom versioning strategy](#custom-versioning) during the `find-my-way` initialization. In this case the logic of matching the request to the specific handler depends on the versioning strategy you use.

##### on(methods[], path, [opts], handler, [store])
Register a new route for each method specified in the `methods` array.
It comes handy when you need to declare multiple routes with the same handler but different methods.
```js
router.on(['GET', 'POST'], '/example', (req, res, params) => {
  // your code
})
```

<a name="supported-path-formats"></a>
##### Supported path formats
To register a **parametric** path, use the *colon* before the parameter name. For **wildcard** use the *star*.
*Remember that static routes are always inserted before parametric and wildcard.*

```js
// parametric
router.on('GET', '/example/:userId', (req, res, params) => {}))
router.on('GET', '/example/:userId/:secretToken', (req, res, params) => {}))

// wildcard
router.on('GET', '/example/*', (req, res, params) => {}))
```

Regular expression routes are supported as well, but pay attention, RegExp are very expensive in term of performance!<br>
If you want to declare a regular expression route, you must put the regular expression inside round parenthesis after the parameter name.
```js
// parametric with regexp
router.on('GET', '/example/:file(^\\d+).png', () => {}))
```

It's possible to define more than one parameter within the same couple of slash ("/"). Such as:
```js
router.on('GET', '/example/near/:lat-:lng/radius/:r', (req, res, params) => {}))
```
*Remember in this case to use the dash ("-") as parameters separator.*

Finally it's possible to have multiple parameters with RegExp.
```js
router.on('GET', '/example/at/:hour(^\\d{2})h:minute(^\\d{2})m', (req, res, params) => {}))
```
In this case as parameter separator it's possible to use whatever character is not matched by the regular expression.

The last parameter can be made optional if you add a question mark ("?") at the end of the parameters name.
```js
router.on('GET', '/example/posts/:id?', (req, res, params) => {}))
```
In this case you can request `/example/posts` as well as `/example/posts/1`. The optional param will be undefined if not specified.

Having a route with multiple parameters may affect negatively the performance, so prefer single parameter approach whenever possible, especially on routes which are on the hot path of your application.

**Note** that you must encode the parameters containing [reserved characters](https://www.rfc-editor.org/rfc/rfc3986#section-2.2).

<a name="match-order"></a>
##### Match order

The routing algorithm matches one chunk at a time (where the chunk is a string between two slashes),
this means that it cannot know if a route is static or dynamic until it finishes to match the URL.

The chunks are matched in the following order:

1. static
1. parametric
1. wildcards
1. parametric(regex)
1. multi parametric(regex)

So if you declare the following routes

- `/:userId/foo/bar`
- `/33/:a(^.*$)/:b`

and the URL of the incoming request is /33/foo/bar,
the second route will be matched because the first chunk (33) matches the static chunk.
If the URL would have been /32/foo/bar, the first route would have been matched.
Once a url has been matched, `find-my-way` will figure out which handler registered for that path matches the request if there are any constraints.
`find-my-way` will check the most constrained handlers first, which means the handlers with the most keys in the `constraints` object.

> If you just want a path containing a colon without declaring a parameter, use a double colon.
> For example, `/name::customVerb` will be interpreted as `/name:customVerb`

<a name="supported-methods"></a>
##### Supported methods
The router is able to route all HTTP methods defined by [`http` core module](https://nodejs.org/api/http.html#http_http_methods).

<a name="off"></a>
#### off(method, path)
Deregister a route.
```js
router.off('GET', '/example')
// => { handler: Function, params: Object, store: Object}
// => null
```

##### off(methods[], path)
Deregister a route for each method specified in the `methods` array.
It comes handy when you need to deregister multiple routes with the same path but different methods.
```js
router.off(['GET', 'POST'], '/example')
// => [{ handler: Function, params: Object, store: Object}]
// => null
```

##### off(methods, path, [constraints])
Deregister a route for each `constraints` key is matched, containing keys like the `host` for the request, the `version` for the route to be matched, or other custom constraint values. See the [constraints section](https://github.com/delvedor/find-my-way#constraints) to know more.
```js
router.off('GET', '/example', { host: 'fastify.io' })
// => [{ handler: Function, params: Object, store: Object}]
// => null
```

<a name="reset"></a>
#### reset()
Empty router.
```js
router.reset()
```

##### Caveats
* It's not possible to register two routes which differs only for their parameters, because internally they would be seen as the same route. In a such case you'll get an early error during the route registration phase. An example is worth thousand words:
```js
const findMyWay = FindMyWay({
  defaultRoute: (req, res) => {}
})

findMyWay.on('GET', '/user/:userId(^\\d+)', (req, res, params) => {})

findMyWay.on('GET', '/user/:username(^[a-z]+)', (req, res, params) => {})
// Method 'GET' already declared for route ':'
```

<a name="shorthand-methods"></a>
##### Shorthand methods
If you want an even nicer api, you can also use the shorthand methods to declare your routes.

For each HTTP supported method, there's the shorthand method. For example:
```js
router.get(path, handler [, store])
router.delete(path, handler [, store])
router.head(path, handler [, store])
router.patch(path, handler [, store])
router.post(path, handler [, store])
router.put(path, handler [, store])
router.options(path, handler [, store])
// ...
```

If you need a route that supports *all* methods you can use the `all` api.
```js
router.all(path, handler [, store])
```

<a name="lookup"></a>
#### lookup(request, response, [context])
Start a new search, `request` and `response` are the server req/res objects.<br>
If a route is found it will automatically call the handler, otherwise the default route will be called.<br>
The url is sanitized internally, all the parameters and wildcards are decoded automatically.
```js
router.lookup(req, res)
```

`lookup` accepts an optional context which will be the value of `this` when executing a handler
```js
router.on('GET', '*', function(req, res) {
  res.end(this.greeting);
})
router.lookup(req, res, { greeting: 'Hello, World!' })
```

<a name="find"></a>
#### find(method, path, [constraints])
Return (if present) the route registered in *method:path*.<br>
The path must be sanitized, all the parameters and wildcards are decoded automatically.<br/>
An object with routing constraints should usually be passed as `constraints`, containing keys like the `host` for the request, the `version` for the route to be matched, or other custom constraint values. If the router is using the default versioning strategy, the version value should be conform to the [semver](https://semver.org/) specification. If you want to use the existing constraint strategies to derive the constraint values from an incoming request, use `lookup` instead of `find`. If no value is passed for `constraints`, the router won't match any constrained routes. If using constrained routes, passing `undefined` for the constraints leads to undefined behavior and should be avoided.

```js
router.find('GET', '/example', { host: 'fastify.io' })
// => { handler: Function, params: Object, store: Object}
// => null

router.find('GET', '/example', { host: 'fastify.io', version: '1.x' })
// => { handler: Function, params: Object, store: Object}
// => null
```

<a name="pretty-print"></a>
#### prettyPrint([{ commonPrefix: false, includeMeta: true || [] }])
Prints the representation of the internal radix tree, useful for debugging.

```js
findMyWay.on('GET', '/test', () => {})
findMyWay.on('GET', '/test/hello', () => {})
findMyWay.on('GET', '/testing', () => {})
findMyWay.on('GET', '/testing/:param', () => {})
findMyWay.on('PUT', '/update', () => {})

console.log(findMyWay.prettyPrint())
// └── /
//     ├── test (GET)
//     │   ├── /hello (GET)
//     │   └── ing (GET)
//     │       └── /:param (GET)
//     └── update (PUT)
```

`prettyPrint` accepts an optional setting to use the internal routes array
to render the tree.

```js
console.log(findMyWay.prettyPrint({ commonPrefix: false }))
// └── / (-)
//     ├── test (GET)
//     │   └── /hello (GET)
//     ├── testing (GET)
//     │   └── /:param (GET)
//     └── update (PUT)
```

To include a display of the `store` data passed to individual routes, the
option `includeMeta` may be passed. If set to `true` all items will be
displayed, this can also be set to an array specifying which keys (if
present) should be displayed. This information can be further sanitized
by specifying a `buildPrettyMeta` function which consumes and returns
an object.

```js
findMyWay.on('GET', '/test', () => {}, { onRequest: () => {}, authIDs => [1,2,3] })
findMyWay.on('GET', '/test/hello', () => {}, { token: 'df123-4567' })
findMyWay.on('GET', '/testing', () => {})
findMyWay.on('GET', '/testing/:param', () => {})
findMyWay.on('PUT', '/update', () => {})

console.log(findMyWay.prettyPrint({ commonPrefix: false, includeMeta: ['onRequest'] }))
// └── /
//     ├── test (GET)
//     │   • (onRequest) "anonymous()"
//     │   ├── /hello (GET)
//     │   └── ing (GET)
//     │       └── /:param (GET)
//     └── update (PUT)

console.log(findMyWay.prettyPrint({ commonPrefix: true, includeMeta: true }))
// └── / (-)
//     ├── test (GET)
//     │   • (onRequest) "anonymous()"
//     │   • (authIDs) [1,2,3]
//     │   └── /hello (GET)
//     │       • (token) "df123-4567"
//     ├── testing (GET)
//     │   └── /:param (GET)
//     └── update (PUT)
```

<a name="routes"></a>
#### routes
Return the all routes **registered** at moment, useful for debugging.

```js
const findMyWay = require('find-my-way')()

findMyWay.on('GET', '/test', () => {})
findMyWay.on('GET', '/test/hello', () => {})

console.log(findMyWay.routes)
// Will print
// [
//   {
//     method: 'GET',
//     path: '/test',
//     opts: {},
//     handler: [Function],
//     store: undefined
//   },
//   {
//     method: 'GET',
//     path: '/test/hello',
//     opts: {},
//     handler: [Function],
//     store: undefined
//   }
// ]
```

<a name="acknowledgements"></a>
## Acknowledgements

It is inspired by the [echo](https://github.com/labstack/echo) router, some parts have been extracted from [trekjs](https://github.com/trekjs) router.

<a name="sponsor"></a>
#### Past sponsor

- [LetzDoIt](http://www.letzdoitapp.com/)

<a name="license"></a>
## License
**[find-my-way - MIT](https://github.com/delvedor/find-my-way/blob/master/LICENSE)**<br>
**[trekjs/router - MIT](https://github.com/trekjs/router/blob/master/LICENSE)**

Copyright © 2017-2019 Tomas Della Vedova
