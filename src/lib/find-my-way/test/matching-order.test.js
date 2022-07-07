'use strict'

const t = require('tap')
const test = t.test
const FindMyWay = require('..')

test('Matching order', t => {
  t.plan(3)
  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/foo/bar/static', { constraints: { host: 'test' } }, () => {})
  findMyWay.on('GET', '/foo/bar/*', () => {})
  findMyWay.on('GET', '/foo/:param/static', () => {})

  t.same(findMyWay.find('GET', '/foo/bar/static', { host: 'test' }).params, {})
  t.same(findMyWay.find('GET', '/foo/bar/static').params, { '*': 'static' })
  t.same(findMyWay.find('GET', '/foo/value/static').params, { param: 'value' })
})
