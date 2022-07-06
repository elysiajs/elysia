'use strict'

const t = require('tap')
const test = t.test
const http = require('http')
const FindMyWay = require('../')

test('basic router with http server', t => {
  t.plan(6)
  const findMyWay = FindMyWay()
  findMyWay.on('GET', '/test', (req, res, params) => {
    t.ok(req)
    t.ok(res)
    t.ok(params)
    res.end(JSON.stringify({ hello: 'world' }))
  })

  const server = http.createServer((req, res) => {
    findMyWay.lookup(req, res)
  })

  server.listen(0, err => {
    t.error(err)
    server.unref()

    http.get('http://localhost:' + server.address().port + '/test', async (res) => {
      let body = ''
      for await (const chunk of res) {
        body += chunk
      }
      t.equal(res.statusCode, 200)
      t.same(JSON.parse(body), { hello: 'world' })
    })
  })
})

test('router with params with http server', t => {
  t.plan(6)
  const findMyWay = FindMyWay()
  findMyWay.on('GET', '/test/:id', (req, res, params) => {
    t.ok(req)
    t.ok(res)
    t.equal(params.id, 'hello')
    res.end(JSON.stringify({ hello: 'world' }))
  })

  const server = http.createServer((req, res) => {
    findMyWay.lookup(req, res)
  })

  server.listen(0, err => {
    t.error(err)
    server.unref()

    http.get('http://localhost:' + server.address().port + '/test/hello', async (res) => {
      let body = ''
      for await (const chunk of res) {
        body += chunk
      }
      t.equal(res.statusCode, 200)
      t.same(JSON.parse(body), { hello: 'world' })
    })
  })
})

test('default route', t => {
  t.plan(2)
  const findMyWay = FindMyWay({
    defaultRoute: (req, res) => {
      res.statusCode = 404
      res.end()
    }
  })

  const server = http.createServer((req, res) => {
    findMyWay.lookup(req, res)
  })

  server.listen(0, err => {
    t.error(err)
    server.unref()

    http.get('http://localhost:' + server.address().port, async (res) => {
      t.equal(res.statusCode, 404)
    })
  })
})

test('automatic default route', t => {
  t.plan(2)
  const findMyWay = FindMyWay()

  const server = http.createServer((req, res) => {
    findMyWay.lookup(req, res)
  })

  server.listen(0, err => {
    t.error(err)
    server.unref()

    http.get('http://localhost:' + server.address().port, async (res) => {
      t.equal(res.statusCode, 404)
    })
  })
})

test('maps two routes when trailing slash should be trimmed', t => {
  t.plan(21)
  const findMyWay = FindMyWay({
    ignoreTrailingSlash: true
  })

  findMyWay.on('GET', '/test/', (req, res, params) => {
    t.ok(req)
    t.ok(res)
    t.ok(params)
    res.end('test')
  })

  findMyWay.on('GET', '/othertest', (req, res, params) => {
    t.ok(req)
    t.ok(res)
    t.ok(params)
    res.end('othertest')
  })

  const server = http.createServer((req, res) => {
    findMyWay.lookup(req, res)
  })

  server.listen(0, err => {
    t.error(err)
    server.unref()

    const baseURL = 'http://localhost:' + server.address().port

    http.get(baseURL + '/test/', async (res) => {
      let body = ''
      for await (const chunk of res) {
        body += chunk
      }
      t.equal(res.statusCode, 200)
      t.same(body, 'test')
    })

    http.get(baseURL + '/test', async (res) => {
      let body = ''
      for await (const chunk of res) {
        body += chunk
      }
      t.equal(res.statusCode, 200)
      t.same(body, 'test')
    })

    http.get(baseURL + '/othertest', async (res) => {
      let body = ''
      for await (const chunk of res) {
        body += chunk
      }
      t.equal(res.statusCode, 200)
      t.same(body, 'othertest')
    })

    http.get(baseURL + '/othertest/', async (res) => {
      let body = ''
      for await (const chunk of res) {
        body += chunk
      }
      t.equal(res.statusCode, 200)
      t.same(body, 'othertest')
    })
  })
})

test('does not trim trailing slash when ignoreTrailingSlash is false', t => {
  t.plan(7)
  const findMyWay = FindMyWay({
    ignoreTrailingSlash: false
  })

  findMyWay.on('GET', '/test/', (req, res, params) => {
    t.ok(req)
    t.ok(res)
    t.ok(params)
    res.end('test')
  })

  const server = http.createServer((req, res) => {
    findMyWay.lookup(req, res)
  })

  server.listen(0, err => {
    t.error(err)
    server.unref()

    const baseURL = 'http://localhost:' + server.address().port

    http.get(baseURL + '/test/', async (res) => {
      let body = ''
      for await (const chunk of res) {
        body += chunk
      }
      t.equal(res.statusCode, 200)
      t.same(body, 'test')
    })

    http.get(baseURL + '/test', async (res) => {
      t.equal(res.statusCode, 404)
    })
  })
})

test('does not map // when ignoreTrailingSlash is true', t => {
  t.plan(7)
  const findMyWay = FindMyWay({
    ignoreTrailingSlash: false
  })

  findMyWay.on('GET', '/', (req, res, params) => {
    t.ok(req)
    t.ok(res)
    t.ok(params)
    res.end('test')
  })

  const server = http.createServer((req, res) => {
    findMyWay.lookup(req, res)
  })

  server.listen(0, err => {
    t.error(err)
    server.unref()

    const baseURL = 'http://localhost:' + server.address().port

    http.get(baseURL + '/', async (res) => {
      let body = ''
      for await (const chunk of res) {
        body += chunk
      }
      t.equal(res.statusCode, 200)
      t.same(body, 'test')
    })

    http.get(baseURL + '//', async (res) => {
      t.equal(res.statusCode, 404)
    })
  })
})

test('maps two routes when duplicate slashes should be trimmed', t => {
  t.plan(21)
  const findMyWay = FindMyWay({
    ignoreDuplicateSlashes: true
  })

  findMyWay.on('GET', '//test', (req, res, params) => {
    t.ok(req)
    t.ok(res)
    t.ok(params)
    res.end('test')
  })

  findMyWay.on('GET', '/othertest', (req, res, params) => {
    t.ok(req)
    t.ok(res)
    t.ok(params)
    res.end('othertest')
  })

  const server = http.createServer((req, res) => {
    findMyWay.lookup(req, res)
  })

  server.listen(0, err => {
    t.error(err)
    server.unref()

    const baseURL = 'http://localhost:' + server.address().port

    http.get(baseURL + '//test', async (res) => {
      let body = ''
      for await (const chunk of res) {
        body += chunk
      }
      t.equal(res.statusCode, 200)
      t.same(body, 'test')
    })

    http.get(baseURL + '/test', async (res) => {
      let body = ''
      for await (const chunk of res) {
        body += chunk
      }
      t.equal(res.statusCode, 200)
      t.same(body, 'test')
    })

    http.get(baseURL + '/othertest', async (res) => {
      let body = ''
      for await (const chunk of res) {
        body += chunk
      }
      t.equal(res.statusCode, 200)
      t.same(body, 'othertest')
    })

    http.get(baseURL + '//othertest', async (res) => {
      let body = ''
      for await (const chunk of res) {
        body += chunk
      }
      t.equal(res.statusCode, 200)
      t.same(body, 'othertest')
    })
  })
})

test('does not trim duplicate slashes when ignoreDuplicateSlashes is false', t => {
  t.plan(7)
  const findMyWay = FindMyWay({
    ignoreDuplicateSlashes: false
  })

  findMyWay.on('GET', '//test', (req, res, params) => {
    t.ok(req)
    t.ok(res)
    t.ok(params)
    res.end('test')
  })

  const server = http.createServer((req, res) => {
    findMyWay.lookup(req, res)
  })

  server.listen(0, err => {
    t.error(err)
    server.unref()

    const baseURL = 'http://localhost:' + server.address().port

    http.get(baseURL + '//test', async (res) => {
      let body = ''
      for await (const chunk of res) {
        body += chunk
      }
      t.equal(res.statusCode, 200)
      t.same(body, 'test')
    })

    http.get(baseURL + '/test', async (res) => {
      t.equal(res.statusCode, 404)
    })
  })
})

test('does map // when ignoreDuplicateSlashes is true', t => {
  t.plan(11)
  const findMyWay = FindMyWay({
    ignoreDuplicateSlashes: true
  })

  findMyWay.on('GET', '/', (req, res, params) => {
    t.ok(req)
    t.ok(res)
    t.ok(params)
    res.end('test')
  })

  const server = http.createServer((req, res) => {
    findMyWay.lookup(req, res)
  })

  server.listen(0, err => {
    t.error(err)
    server.unref()

    const baseURL = 'http://localhost:' + server.address().port

    http.get(baseURL + '/', async (res) => {
      let body = ''
      for await (const chunk of res) {
        body += chunk
      }
      t.equal(res.statusCode, 200)
      t.same(body, 'test')
    })

    http.get(baseURL + '//', async (res) => {
      let body = ''
      for await (const chunk of res) {
        body += chunk
      }
      t.equal(res.statusCode, 200)
      t.same(body, 'test')
    })
  })
})

test('versioned routes', t => {
  t.plan(3)

  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/test', { constraints: { version: '1.2.3' } }, (req, res, params) => {
    res.end('ok')
  })

  const server = http.createServer((req, res) => {
    findMyWay.lookup(req, res)
  })

  server.listen(0, err => {
    t.error(err)
    server.unref()

    http.get(
      'http://localhost:' + server.address().port + '/test',
      {
        headers: { 'Accept-Version': '1.x' }
      },
      async (res) => {
        t.equal(res.statusCode, 200)
      }
    )

    http.get(
      'http://localhost:' + server.address().port + '/test',
      {
        headers: { 'Accept-Version': '2.x' }
      },
      async (res) => {
        t.equal(res.statusCode, 404)
      }
    )
  })
})
