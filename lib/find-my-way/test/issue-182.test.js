'use strict'

const t = require('tap')
const test = t.test
const FindMyWay = require('..')

test('Set method property when splitting node', t => {
  t.plan(1)
  const findMyWay = FindMyWay()

  function handler (req, res, params) {
    t.pass()
  }

  findMyWay.on('GET', '/health-a/health', handler)
  findMyWay.on('GET', '/health-b/health', handler)

  t.notMatch(findMyWay.prettyPrint(), /undefined/)
})
