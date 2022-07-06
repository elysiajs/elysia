'use strict'

const t = require('tap')
const test = t.test
const FindMyWay = require('..')
const noop = () => {}

test('Should throw when not sending a string', t => {
  t.plan(3)

  const findMyWay = FindMyWay()

  t.throws(() => {
    findMyWay.on('GET', '/t1', { constraints: { version: 42 } }, noop)
  })
  t.throws(() => {
    findMyWay.on('GET', '/t2', { constraints: { version: null } }, noop)
  })
  t.throws(() => {
    findMyWay.on('GET', '/t2', { constraints: { version: true } }, noop)
  })
})
