'use strict'

const t = require('tap')
const test = t.test
const FindMyWay = require('../')

test('contain param and wildcard together', t => {
  t.plan(4)

  const findMyWay = FindMyWay({
    defaultRoute: (req, res) => {
      t.fail('we should not be here, the url is: ' + req.url)
    }
  })

  findMyWay.on('GET', '/:lang/item/:id', (req, res, params) => {
    t.same(params.lang, 'fr')
    t.same(params.id, '12345')
  })

  findMyWay.on('GET', '/:lang/item/*', (req, res, params) => {
    t.same(params.lang, 'fr')
    t.same(params['*'], '12345/edit')
  })

  findMyWay.lookup(
    { method: 'GET', url: '/fr/item/12345', headers: {} },
    null
  )

  findMyWay.lookup(
    { method: 'GET', url: '/fr/item/12345/edit', headers: {} },
    null
  )
})
