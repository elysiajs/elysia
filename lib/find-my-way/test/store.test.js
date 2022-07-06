'use strict'

const t = require('tap')
const test = t.test
const FindMyWay = require('../')

test('handler should have the store object', t => {
  t.plan(1)
  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/test', (req, res, params, store) => {
    t.equal(store.hello, 'world')
  }, { hello: 'world' })

  findMyWay.lookup({ method: 'GET', url: '/test', headers: {} }, null)
})

test('find a store object', t => {
  t.plan(1)
  const findMyWay = FindMyWay()
  const fn = () => {}

  findMyWay.on('GET', '/test', fn, { hello: 'world' })

  t.same(findMyWay.find('GET', '/test'), {
    handler: fn,
    params: {},
    store: { hello: 'world' },
    searchParams: {}
  })
})

test('update the store', t => {
  t.plan(2)
  const findMyWay = FindMyWay()
  var bool = false

  findMyWay.on('GET', '/test', (req, res, params, store) => {
    if (!bool) {
      t.equal(store.hello, 'world')
      store.hello = 'hello'
      bool = true
      findMyWay.lookup({ method: 'GET', url: '/test', headers: {} }, null)
    } else {
      t.equal(store.hello, 'hello')
    }
  }, { hello: 'world' })

  findMyWay.lookup({ method: 'GET', url: '/test', headers: {} }, null)
})
