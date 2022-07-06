'use strict'

const t = require('tap')
const test = t.test
const FindMyWay = require('../')

test('Falling back for node\'s parametric brother', t => {
  t.plan(3)
  const findMyWay = FindMyWay({
    defaultRoute: (req, res) => {
      t.fail('Should not be defaultRoute')
    }
  })

  findMyWay.on('GET', '/foo/:id', () => {})
  findMyWay.on('GET', '/foo/:color/:id', () => {})
  findMyWay.on('GET', '/foo/red', () => {})

  t.same(findMyWay.find('GET', '/foo/red/123').params, { color: 'red', id: '123' })
  t.same(findMyWay.find('GET', '/foo/blue/123').params, { color: 'blue', id: '123' })
  t.same(findMyWay.find('GET', '/foo/red').params, {})
})
