'use strict'

const { test } = require('tap')
const FindMyWay = require('../')

function initializeRoutes (router, handler, quantity) {
  for (const x of Array(quantity).keys()) {
    router.on('GET', '/test-route-' + x, handler)
  }
  return router
}

test('verify routes registered', t => {
  const quantity = 5
  // 1 (check length) + quantity of routes * quantity of tests per route
  t.plan(1 + (quantity * 1))

  let findMyWay = FindMyWay()
  const defaultHandler = (req, res, params) => res.end(JSON.stringify({ hello: 'world' }))

  findMyWay = initializeRoutes(findMyWay, defaultHandler, quantity)
  t.equal(findMyWay.routes.length, quantity)
  findMyWay.routes.map((route, idx) => {
    t.same(route, {
      method: 'GET',
      path: '/test-route-' + idx,
      opts: {},
      handler: defaultHandler,
      store: undefined
    })
  })
})

test('verify routes registered and deregister', t => {
  // 1 (check length) + quantity of routes * quantity of tests per route
  t.plan(2)

  let findMyWay = FindMyWay()
  const quantity = 2
  const defaultHandler = (req, res, params) => res.end(JSON.stringify({ hello: 'world' }))

  findMyWay = initializeRoutes(findMyWay, defaultHandler, quantity)
  t.equal(findMyWay.routes.length, quantity)
  findMyWay.off('GET', '/test-route-0')
  t.equal(findMyWay.routes.length, quantity - 1)
})
