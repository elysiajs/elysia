'use strict'

const t = require('tap')
const test = t.test
const FindMyWay = require('../')

test('maxParamLength default value is 500', t => {
  t.plan(1)

  const findMyWay = FindMyWay()
  t.equal(findMyWay.maxParamLength, 100)
})

test('maxParamLength should set the maximum length for a parametric route', t => {
  t.plan(1)

  const findMyWay = FindMyWay({ maxParamLength: 10 })
  findMyWay.on('GET', '/test/:param', () => {})
  t.same(findMyWay.find('GET', '/test/123456789abcd'), null)
})

test('maxParamLength should set the maximum length for a parametric (regex) route', t => {
  t.plan(1)

  const findMyWay = FindMyWay({ maxParamLength: 10 })
  findMyWay.on('GET', '/test/:param(^\\d+$)', () => {})

  t.same(findMyWay.find('GET', '/test/123456789abcd'), null)
})

test('maxParamLength should set the maximum length for a parametric (multi) route', t => {
  t.plan(1)

  const findMyWay = FindMyWay({ maxParamLength: 10 })
  findMyWay.on('GET', '/test/:param-bar', () => {})
  t.same(findMyWay.find('GET', '/test/123456789abcd'), null)
})

test('maxParamLength should set the maximum length for a parametric (regex with suffix) route', t => {
  t.plan(1)

  const findMyWay = FindMyWay({ maxParamLength: 10 })
  findMyWay.on('GET', '/test/:param(^\\w{3})bar', () => {})
  t.same(findMyWay.find('GET', '/test/123456789abcd'), null)
})
