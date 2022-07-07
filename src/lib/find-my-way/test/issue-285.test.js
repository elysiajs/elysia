'use strict'

const t = require('tap')
const test = t.test
const FindMyWay = require('../')

test('Parametric regex match with similar routes', (t) => {
  t.plan(2)
  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/:a(a)', () => {})
  findMyWay.on('GET', '/:param/static', () => {})

  t.same(findMyWay.find('GET', '/a', {}).params, { a: 'a' })
  t.same(findMyWay.find('GET', '/param/static', {}).params, { param: 'param' })
})

test('Parametric regex match with similar routes', (t) => {
  t.plan(2)
  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/:a(a)', () => {})
  findMyWay.on('GET', '/:b(b)/static', () => {})

  t.same(findMyWay.find('GET', '/a', {}).params, { a: 'a' })
  t.same(findMyWay.find('GET', '/b/static', {}).params, { b: 'b' })
})

test('Parametric regex match with similar routes', (t) => {
  t.plan(2)
  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/:a(a)/static', { constraints: { version: '1.0.0' } }, () => {})
  findMyWay.on('GET', '/:b(b)/static', { constraints: { version: '2.0.0' } }, () => {})

  t.same(findMyWay.find('GET', '/a/static', { version: '1.0.0' }).params, { a: 'a' })
  t.same(findMyWay.find('GET', '/b/static', { version: '2.0.0' }).params, { b: 'b' })
})
