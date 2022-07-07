'use strict'

const t = require('tap')
const test = t.test
const FindMyWay = require('../')

test('the router is an object with methods', t => {
  t.plan(4)

  const findMyWay = FindMyWay()

  t.equal(typeof findMyWay.on, 'function')
  t.equal(typeof findMyWay.off, 'function')
  t.equal(typeof findMyWay.lookup, 'function')
  t.equal(typeof findMyWay.find, 'function')
})

test('on throws for invalid method', t => {
  t.plan(1)
  const findMyWay = FindMyWay()

  t.throws(() => {
    findMyWay.on('INVALID', '/a/b')
  })
})

test('on throws for invalid path', t => {
  t.plan(3)
  const findMyWay = FindMyWay()

  // Non string
  t.throws(() => {
    findMyWay.on('GET', 1)
  })

  // Empty
  t.throws(() => {
    findMyWay.on('GET', '')
  })

  // Doesn't start with / or *
  t.throws(() => {
    findMyWay.on('GET', 'invalid')
  })
})

test('register a route', t => {
  t.plan(1)
  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/test', () => {
    t.ok('inside the handler')
  })

  findMyWay.lookup({ method: 'GET', url: '/test', headers: {} }, null)
})

test('register a route with multiple methods', t => {
  t.plan(2)
  const findMyWay = FindMyWay()

  findMyWay.on(['GET', 'POST'], '/test', () => {
    t.ok('inside the handler')
  })

  findMyWay.lookup({ method: 'GET', url: '/test', headers: {} }, null)
  findMyWay.lookup({ method: 'POST', url: '/test', headers: {} }, null)
})

test('does not register /test/*/ when ignoreTrailingSlash is true', t => {
  t.plan(1)
  const findMyWay = FindMyWay({
    ignoreTrailingSlash: true
  })

  findMyWay.on('GET', '/test/*', () => {})
  t.equal(
    findMyWay.routes.filter((r) => r.path.includes('/test')).length,
    1
  )
})

test('off throws for invalid method', t => {
  t.plan(1)
  const findMyWay = FindMyWay()

  t.throws(() => {
    findMyWay.off('INVALID', '/a/b')
  })
})

test('off throws for invalid path', t => {
  t.plan(3)
  const findMyWay = FindMyWay()

  // Non string
  t.throws(() => {
    findMyWay.off('GET', 1)
  })

  // Empty
  t.throws(() => {
    findMyWay.off('GET', '')
  })

  // Doesn't start with / or *
  t.throws(() => {
    findMyWay.off('GET', 'invalid')
  })
})

test('off with nested wildcards with parametric and static', t => {
  t.plan(3)
  const findMyWay = FindMyWay({
    defaultRoute: (req, res) => {
      t.fail('we should not be here, the url is: ' + req.url)
    }
  })

  findMyWay.on('GET', '*', (req, res, params) => {
    t.equal(params['*'], '/foo2/first/second')
  })
  findMyWay.on('GET', '/foo1/*', () => {})
  findMyWay.on('GET', '/foo2/*', () => {})
  findMyWay.on('GET', '/foo3/:param', () => {})
  findMyWay.on('GET', '/foo3/*', () => {})
  findMyWay.on('GET', '/foo4/param/hello/test/long/route', () => {})

  var route1 = findMyWay.find('GET', '/foo3/first/second')
  t.equal(route1.params['*'], 'first/second')

  findMyWay.off('GET', '/foo3/*')

  var route2 = findMyWay.find('GET', '/foo3/first/second')
  t.equal(route2.params['*'], '/foo3/first/second')

  findMyWay.off('GET', '/foo2/*')
  findMyWay.lookup(
    { method: 'GET', url: '/foo2/first/second', headers: {} },
    null
  )
})

test('off removes all routes when ignoreTrailingSlash is true', t => {
  t.plan(6)
  const findMyWay = FindMyWay({
    ignoreTrailingSlash: true
  })

  findMyWay.on('GET', '/test1/', () => {})
  t.equal(findMyWay.routes.length, 1)

  findMyWay.on('GET', '/test2', () => {})
  t.equal(findMyWay.routes.length, 2)

  findMyWay.off('GET', '/test1')
  t.equal(findMyWay.routes.length, 1)
  t.equal(
    findMyWay.routes.filter((r) => r.path === '/test2').length,
    1
  )
  t.equal(
    findMyWay.routes.filter((r) => r.path === '/test2/').length,
    0
  )

  findMyWay.off('GET', '/test2/')
  t.equal(findMyWay.routes.length, 0)
})

test('off removes all routes when ignoreDuplicateSlashes is true', t => {
  t.plan(6)
  const findMyWay = FindMyWay({
    ignoreDuplicateSlashes: true
  })

  findMyWay.on('GET', '//test1', () => {})
  t.equal(findMyWay.routes.length, 1)

  findMyWay.on('GET', '/test2', () => {})
  t.equal(findMyWay.routes.length, 2)

  findMyWay.off('GET', '/test1')
  t.equal(findMyWay.routes.length, 1)
  t.equal(
    findMyWay.routes.filter((r) => r.path === '/test2').length,
    1
  )
  t.equal(
    findMyWay.routes.filter((r) => r.path === '//test2').length,
    0
  )

  findMyWay.off('GET', '//test2')
  t.equal(findMyWay.routes.length, 0)
})

test('deregister a route without children', t => {
  t.plan(2)
  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/a', () => {})
  findMyWay.on('GET', '/a/b', () => {})
  findMyWay.off('GET', '/a/b')

  t.ok(findMyWay.find('GET', '/a'))
  t.notOk(findMyWay.find('GET', '/a/b'))
})

test('deregister a route with children', t => {
  t.plan(2)
  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/a', () => {})
  findMyWay.on('GET', '/a/b', () => {})
  findMyWay.off('GET', '/a')

  t.notOk(findMyWay.find('GET', '/a'))
  t.ok(findMyWay.find('GET', '/a/b'))
})

test('deregister a route by method', t => {
  t.plan(2)
  const findMyWay = FindMyWay()

  findMyWay.on(['GET', 'POST'], '/a', () => {})
  findMyWay.off('GET', '/a')

  t.notOk(findMyWay.find('GET', '/a'))
  t.ok(findMyWay.find('POST', '/a'))
})

test('deregister a route with multiple methods', t => {
  t.plan(2)
  const findMyWay = FindMyWay()

  findMyWay.on(['GET', 'POST'], '/a', () => {})
  findMyWay.off(['GET', 'POST'], '/a')

  t.notOk(findMyWay.find('GET', '/a'))
  t.notOk(findMyWay.find('POST', '/a'))
})

test('reset a router', t => {
  t.plan(2)
  const findMyWay = FindMyWay()

  findMyWay.on(['GET', 'POST'], '/a', () => {})
  findMyWay.reset()

  t.notOk(findMyWay.find('GET', '/a'))
  t.notOk(findMyWay.find('POST', '/a'))
})

test('default route', t => {
  t.plan(1)

  const findMyWay = FindMyWay({
    defaultRoute: () => {
      t.ok('inside the default route')
    }
  })

  findMyWay.lookup({ method: 'GET', url: '/test', headers: {} }, null)
})

test('parametric route', t => {
  t.plan(1)
  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/test/:id', (req, res, params) => {
    t.equal(params.id, 'hello')
  })

  findMyWay.lookup({ method: 'GET', url: '/test/hello', headers: {} }, null)
})

test('multiple parametric route', t => {
  t.plan(2)
  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/test/:id', (req, res, params) => {
    t.equal(params.id, 'hello')
  })

  findMyWay.on('GET', '/other-test/:id', (req, res, params) => {
    t.equal(params.id, 'world')
  })

  findMyWay.lookup({ method: 'GET', url: '/test/hello', headers: {} }, null)
  findMyWay.lookup({ method: 'GET', url: '/other-test/world', headers: {} }, null)
})

test('multiple parametric route with the same prefix', t => {
  t.plan(2)
  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/test/:id', (req, res, params) => {
    t.equal(params.id, 'hello')
  })

  findMyWay.on('GET', '/test/:id/world', (req, res, params) => {
    t.equal(params.id, 'world')
  })

  findMyWay.lookup({ method: 'GET', url: '/test/hello', headers: {} }, null)
  findMyWay.lookup({ method: 'GET', url: '/test/world/world', headers: {} }, null)
})

test('nested parametric route', t => {
  t.plan(2)
  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/test/:hello/test/:world', (req, res, params) => {
    t.equal(params.hello, 'hello')
    t.equal(params.world, 'world')
  })

  findMyWay.lookup({ method: 'GET', url: '/test/hello/test/world', headers: {} }, null)
})

test('nested parametric route with same prefix', t => {
  t.plan(3)
  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/test', (req, res, params) => {
    t.ok('inside route')
  })

  findMyWay.on('GET', '/test/:hello/test/:world', (req, res, params) => {
    t.equal(params.hello, 'hello')
    t.equal(params.world, 'world')
  })

  findMyWay.lookup({ method: 'GET', url: '/test', headers: {} }, null)
  findMyWay.lookup({ method: 'GET', url: '/test/hello/test/world', headers: {} }, null)
})

test('long route', t => {
  t.plan(1)
  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/abc/def/ghi/lmn/opq/rst/uvz', (req, res, params) => {
    t.ok('inside long path')
  })

  findMyWay.lookup({ method: 'GET', url: '/abc/def/ghi/lmn/opq/rst/uvz', headers: {} }, null)
})

test('long parametric route', t => {
  t.plan(3)
  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/abc/:def/ghi/:lmn/opq/:rst/uvz', (req, res, params) => {
    t.equal(params.def, 'def')
    t.equal(params.lmn, 'lmn')
    t.equal(params.rst, 'rst')
  })

  findMyWay.lookup({ method: 'GET', url: '/abc/def/ghi/lmn/opq/rst/uvz', headers: {} }, null)
})

test('long parametric route with common prefix', t => {
  t.plan(9)
  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/', (req, res, params) => {
    throw new Error('I shoul not be here')
  })

  findMyWay.on('GET', '/abc', (req, res, params) => {
    throw new Error('I shoul not be here')
  })

  findMyWay.on('GET', '/abc/:def', (req, res, params) => {
    t.equal(params.def, 'def')
  })

  findMyWay.on('GET', '/abc/:def/ghi/:lmn', (req, res, params) => {
    t.equal(params.def, 'def')
    t.equal(params.lmn, 'lmn')
  })

  findMyWay.on('GET', '/abc/:def/ghi/:lmn/opq/:rst', (req, res, params) => {
    t.equal(params.def, 'def')
    t.equal(params.lmn, 'lmn')
    t.equal(params.rst, 'rst')
  })

  findMyWay.on('GET', '/abc/:def/ghi/:lmn/opq/:rst/uvz', (req, res, params) => {
    t.equal(params.def, 'def')
    t.equal(params.lmn, 'lmn')
    t.equal(params.rst, 'rst')
  })

  findMyWay.lookup({ method: 'GET', url: '/abc/def', headers: {} }, null)
  findMyWay.lookup({ method: 'GET', url: '/abc/def/ghi/lmn', headers: {} }, null)
  findMyWay.lookup({ method: 'GET', url: '/abc/def/ghi/lmn/opq/rst', headers: {} }, null)
  findMyWay.lookup({ method: 'GET', url: '/abc/def/ghi/lmn/opq/rst/uvz', headers: {} }, null)
})

test('common prefix', t => {
  t.plan(4)
  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/f', (req, res, params) => {
    t.ok('inside route')
  })

  findMyWay.on('GET', '/ff', (req, res, params) => {
    t.ok('inside route')
  })

  findMyWay.on('GET', '/ffa', (req, res, params) => {
    t.ok('inside route')
  })

  findMyWay.on('GET', '/ffb', (req, res, params) => {
    t.ok('inside route')
  })

  findMyWay.lookup({ method: 'GET', url: '/f', headers: {} }, null)
  findMyWay.lookup({ method: 'GET', url: '/ff', headers: {} }, null)
  findMyWay.lookup({ method: 'GET', url: '/ffa', headers: {} }, null)
  findMyWay.lookup({ method: 'GET', url: '/ffb', headers: {} }, null)
})

test('wildcard', t => {
  t.plan(1)
  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/test/*', (req, res, params) => {
    t.equal(params['*'], 'hello')
  })

  findMyWay.lookup(
    { method: 'GET', url: '/test/hello', headers: {} },
    null
  )
})

test('catch all wildcard', t => {
  t.plan(1)
  const findMyWay = FindMyWay()

  findMyWay.on('GET', '*', (req, res, params) => {
    t.equal(params['*'], '/test/hello')
  })

  findMyWay.lookup(
    { method: 'GET', url: '/test/hello', headers: {} },
    null
  )
})

test('find should return the route', t => {
  t.plan(1)
  const findMyWay = FindMyWay()
  const fn = () => {}

  findMyWay.on('GET', '/test', fn)

  t.same(
    findMyWay.find('GET', '/test'),
    { handler: fn, params: {}, store: null, searchParams: {} }
  )
})

test('find should return the route with params', t => {
  t.plan(1)
  const findMyWay = FindMyWay()
  const fn = () => {}

  findMyWay.on('GET', '/test/:id', fn)

  t.same(
    findMyWay.find('GET', '/test/hello'),
    { handler: fn, params: { id: 'hello' }, store: null, searchParams: {} }
  )
})

test('find should return a null handler if the route does not exist', t => {
  t.plan(1)
  const findMyWay = FindMyWay()

  t.same(
    findMyWay.find('GET', '/test'),
    null
  )
})

test('should decode the uri - parametric', t => {
  t.plan(1)
  const findMyWay = FindMyWay()
  const fn = () => {}

  findMyWay.on('GET', '/test/:id', fn)

  t.same(
    findMyWay.find('GET', '/test/he%2Fllo'),
    { handler: fn, params: { id: 'he/llo' }, store: null, searchParams: {} }
  )
})

test('should decode the uri - wildcard', t => {
  t.plan(1)
  const findMyWay = FindMyWay()
  const fn = () => {}

  findMyWay.on('GET', '/test/*', fn)

  t.same(
    findMyWay.find('GET', '/test/he%2Fllo'),
    { handler: fn, params: { '*': 'he/llo' }, store: null, searchParams: {} }
  )
})

test('safe decodeURIComponent', t => {
  t.plan(1)
  const findMyWay = FindMyWay()
  const fn = () => {}

  findMyWay.on('GET', '/test/:id', fn)

  t.same(
    findMyWay.find('GET', '/test/hel%"Flo'),
    null
  )
})

test('safe decodeURIComponent - nested route', t => {
  t.plan(1)
  const findMyWay = FindMyWay()
  const fn = () => {}

  findMyWay.on('GET', '/test/hello/world/:id/blah', fn)

  t.same(
    findMyWay.find('GET', '/test/hello/world/hel%"Flo/blah'),
    null
  )
})

test('safe decodeURIComponent - wildcard', t => {
  t.plan(1)
  const findMyWay = FindMyWay()
  const fn = () => {}

  findMyWay.on('GET', '/test/*', fn)

  t.same(
    findMyWay.find('GET', '/test/hel%"Flo'),
    null
  )
})

test('static routes should be inserted before parametric / 1', t => {
  t.plan(1)
  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/test/hello', () => {
    t.pass('inside correct handler')
  })

  findMyWay.on('GET', '/test/:id', () => {
    t.fail('wrong handler')
  })

  findMyWay.lookup({ method: 'GET', url: '/test/hello', headers: {} }, null)
})

test('static routes should be inserted before parametric / 2', t => {
  t.plan(1)
  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/test/:id', () => {
    t.fail('wrong handler')
  })

  findMyWay.on('GET', '/test/hello', () => {
    t.pass('inside correct handler')
  })

  findMyWay.lookup({ method: 'GET', url: '/test/hello', headers: {} }, null)
})

test('static routes should be inserted before parametric / 3', t => {
  t.plan(2)
  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/:id', () => {
    t.fail('wrong handler')
  })

  findMyWay.on('GET', '/test', () => {
    t.ok('inside correct handler')
  })

  findMyWay.on('GET', '/test/:id', () => {
    t.fail('wrong handler')
  })

  findMyWay.on('GET', '/test/hello', () => {
    t.ok('inside correct handler')
  })

  findMyWay.lookup({ method: 'GET', url: '/test', headers: {} }, null)
  findMyWay.lookup({ method: 'GET', url: '/test/hello', headers: {} }, null)
})

test('static routes should be inserted before parametric / 4', t => {
  t.plan(2)
  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/:id', () => {
    t.ok('inside correct handler')
  })

  findMyWay.on('GET', '/test', () => {
    t.fail('wrong handler')
  })

  findMyWay.on('GET', '/test/:id', () => {
    t.ok('inside correct handler')
  })

  findMyWay.on('GET', '/test/hello', () => {
    t.fail('wrong handler')
  })

  findMyWay.lookup({ method: 'GET', url: '/test/id', headers: {} }, null)
  findMyWay.lookup({ method: 'GET', url: '/id', headers: {} }, null)
})

test('Static parametric with shared part of the path', t => {
  t.plan(2)

  const findMyWay = FindMyWay({
    defaultRoute: (req, res) => {
      t.equal(req.url, '/example/shared/nested/oopss')
    }
  })

  findMyWay.on('GET', '/example/shared/nested/test', (req, res, params) => {
    t.fail('We should not be here')
  })

  findMyWay.on('GET', '/example/:param/nested/oops', (req, res, params) => {
    t.equal(params.param, 'other')
  })

  findMyWay.lookup({ method: 'GET', url: '/example/shared/nested/oopss', headers: {} }, null)
  findMyWay.lookup({ method: 'GET', url: '/example/other/nested/oops', headers: {} }, null)
})

test('parametric route with different method', t => {
  t.plan(2)
  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/test/:id', (req, res, params) => {
    t.equal(params.id, 'hello')
  })

  findMyWay.on('POST', '/test/:other', (req, res, params) => {
    t.equal(params.other, 'world')
  })

  findMyWay.lookup({ method: 'GET', url: '/test/hello', headers: {} }, null)
  findMyWay.lookup({ method: 'POST', url: '/test/world', headers: {} }, null)
})

test('params does not keep the object reference', t => {
  t.plan(2)
  const findMyWay = FindMyWay()
  var first = true

  findMyWay.on('GET', '/test/:id', (req, res, params) => {
    if (first) {
      setTimeout(() => {
        t.equal(params.id, 'hello')
      }, 10)
    } else {
      setTimeout(() => {
        t.equal(params.id, 'world')
      }, 10)
    }
    first = false
  })

  findMyWay.lookup({ method: 'GET', url: '/test/hello', headers: {} }, null)
  findMyWay.lookup({ method: 'GET', url: '/test/world', headers: {} }, null)
})

test('Unsupported method (static)', t => {
  t.plan(1)
  const findMyWay = FindMyWay({
    defaultRoute: (req, res) => {
      t.pass('Everything ok')
    }
  })

  findMyWay.on('GET', '/', (req, res, params) => {
    t.fail('We should not be here')
  })

  findMyWay.lookup({ method: 'TROLL', url: '/', headers: {} }, null)
})

test('Unsupported method (wildcard)', t => {
  t.plan(1)
  const findMyWay = FindMyWay({
    defaultRoute: (req, res) => {
      t.pass('Everything ok')
    }
  })

  findMyWay.on('GET', '*', (req, res, params) => {
    t.fail('We should not be here')
  })

  findMyWay.lookup({ method: 'TROLL', url: '/hello/world', headers: {} }, null)
})

test('Unsupported method (static find)', t => {
  t.plan(1)
  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/', () => {})

  t.same(findMyWay.find('TROLL', '/'), null)
})

test('Unsupported method (wildcard find)', t => {
  t.plan(1)
  const findMyWay = FindMyWay()

  findMyWay.on('GET', '*', () => {})

  t.same(findMyWay.find('TROLL', '/hello/world'), null)
})

test('register all known HTTP methods', t => {
  t.plan(6)
  const findMyWay = FindMyWay()

  const http = require('http')
  const handlers = {}
  for (var i in http.METHODS) {
    var m = http.METHODS[i]
    handlers[m] = function myHandler () {}
    findMyWay.on(m, '/test', handlers[m])
  }

  t.ok(findMyWay.find('COPY', '/test'))
  t.equal(findMyWay.find('COPY', '/test').handler, handlers.COPY)

  t.ok(findMyWay.find('SUBSCRIBE', '/test'))
  t.equal(findMyWay.find('SUBSCRIBE', '/test').handler, handlers.SUBSCRIBE)

  t.ok(findMyWay.find('M-SEARCH', '/test'))
  t.equal(findMyWay.find('M-SEARCH', '/test').handler, handlers['M-SEARCH'])
})
