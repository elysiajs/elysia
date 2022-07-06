'use strict'

const t = require('tap')
const test = t.test
const querystring = require('querystring')
const FindMyWay = require('../')

test('Custom querystring parser', t => {
  t.plan(2)

  const findMyWay = FindMyWay({
    querystringParser: function (str) {
      t.equal(str, 'foo=bar&baz=faz')
      return querystring.parse(str)
    }
  })
  findMyWay.on('GET', '/', () => {})

  t.same(findMyWay.find('GET', '/?foo=bar&baz=faz').searchParams, { foo: 'bar', baz: 'faz' })
})

test('Custom querystring parser should be called also if there is nothing to parse', t => {
  t.plan(2)

  const findMyWay = FindMyWay({
    querystringParser: function (str) {
      t.equal(str, '')
      return querystring.parse(str)
    }
  })
  findMyWay.on('GET', '/', () => {})

  t.same(findMyWay.find('GET', '/').searchParams, {})
})

test('Querystring without value', t => {
  t.plan(2)

  const findMyWay = FindMyWay({
    querystringParser: function (str) {
      t.equal(str, 'foo')
      return querystring.parse(str)
    }
  })
  findMyWay.on('GET', '/', () => {})
  t.same(findMyWay.find('GET', '/?foo').searchParams, { foo: '' })
})
