'use strict'

const t = require('tap')
const FindMyWay = require('../')

t.test('issue-240: .find matching', (t) => {
  t.plan(14)

  const findMyWay = FindMyWay({ ignoreDuplicateSlashes: true })

  const fixedPath = function staticPath () {}
  const varPath = function parameterPath () {}
  findMyWay.on('GET', '/a/b', fixedPath)
  findMyWay.on('GET', '/a/:pam/c', varPath)

  t.equal(findMyWay.find('GET', '/a/b').handler, fixedPath)
  t.equal(findMyWay.find('GET', '/a//b').handler, fixedPath)
  t.equal(findMyWay.find('GET', '/a/b/c').handler, varPath)
  t.equal(findMyWay.find('GET', '/a//b/c').handler, varPath)
  t.equal(findMyWay.find('GET', '/a///b/c').handler, varPath)
  t.equal(findMyWay.find('GET', '/a//b//c').handler, varPath)
  t.equal(findMyWay.find('GET', '/a///b///c').handler, varPath)
  t.equal(findMyWay.find('GET', '/a/foo/c').handler, varPath)
  t.equal(findMyWay.find('GET', '/a//foo/c').handler, varPath)
  t.equal(findMyWay.find('GET', '/a///foo/c').handler, varPath)
  t.equal(findMyWay.find('GET', '/a//foo//c').handler, varPath)
  t.equal(findMyWay.find('GET', '/a///foo///c').handler, varPath)
  t.notOk(findMyWay.find('GET', '/a/c'))
  t.notOk(findMyWay.find('GET', '/a//c'))
})
