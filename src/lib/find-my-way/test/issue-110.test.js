'use strict'

const t = require('tap')
const test = t.test
const FindMyWay = require('../')

test('Nested static parametric route, url with parameter common prefix > 1', t => {
  t.plan(1)
  const findMyWay = FindMyWay({
    defaultRoute: (req, res) => {
      t.fail('Should not be defaultRoute')
    }
  })

  findMyWay.on('GET', '/api/foo/b2', (req, res) => {
    res.end('{"message":"hello world"}')
  })

  findMyWay.on('GET', '/api/foo/bar/qux', (req, res) => {
    res.end('{"message":"hello world"}')
  })

  findMyWay.on('GET', '/api/foo/:id/bar', (req, res) => {
    res.end('{"message":"hello world"}')
  })

  findMyWay.on('GET', '/foo', (req, res) => {
    res.end('{"message":"hello world"}')
  })

  t.same(findMyWay.find('GET', '/api/foo/b-123/bar').params, { id: 'b-123' })
})
