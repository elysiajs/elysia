'use strict'

const t = require('tap')
const factory = require('../')

const noop = function () {}

t.test('issue-63', (t) => {
  t.plan(2)

  const fmw = factory()

  t.throws(function () {
    fmw.on('GET', '/foo/:id(a', noop)
  })

  try {
    fmw.on('GET', '/foo/:id(a', noop)
    t.fail('should fail')
  } catch (err) {
    t.equal(err.message, 'Invalid regexp expression in "/foo/:id(a"')
  }
})
