'use strict'

const t = require('tap')
const FindMyWay = require('../')

const noop = function () {}

t.test('issue-62', (t) => {
  t.plan(2)

  const findMyWay = FindMyWay({ allowUnsafeRegex: true })

  findMyWay.on('GET', '/foo/:id(([a-f0-9]{3},?)+)', noop)

  t.notOk(findMyWay.find('GET', '/foo/qwerty'))
  t.ok(findMyWay.find('GET', '/foo/bac,1ea'))
})

t.test('issue-62 - escape chars', (t) => {
  const findMyWay = FindMyWay()

  t.plan(2)

  findMyWay.get('/foo/:param(\\([a-f0-9]{3}\\))', noop)

  t.notOk(findMyWay.find('GET', '/foo/abc'))
  t.ok(findMyWay.find('GET', '/foo/(abc)', {}))
})
