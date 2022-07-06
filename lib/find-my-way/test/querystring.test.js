'use strict'

const t = require('tap')
const test = t.test
const FindMyWay = require('../')

test('should sanitize the url - query', t => {
  t.plan(2)
  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/test', (req, res, params, store, query) => {
    t.same(query, { hello: 'world' })
    t.ok('inside the handler')
  })

  findMyWay.lookup({ method: 'GET', url: '/test?hello=world', headers: {} }, null)
})

test('should sanitize the url - hash', t => {
  t.plan(2)
  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/test', (req, res, params, store, query) => {
    t.same(query, { hello: '' })
    t.ok('inside the handler')
  })

  findMyWay.lookup({ method: 'GET', url: '/test#hello', headers: {} }, null)
})

test('handles path and query separated by ;', t => {
  t.plan(2)
  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/test', (req, res, params, store, query) => {
    t.same(query, { jsessionid: '123456' })
    t.ok('inside the handler')
  })

  findMyWay.lookup({ method: 'GET', url: '/test;jsessionid=123456', headers: {} }, null)
})
