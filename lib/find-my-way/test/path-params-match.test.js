'use strict'

const t = require('tap')
const FindMyWay = require('../')

t.test('path params match', (t) => {
  t.plan(24)

  const findMyWay = FindMyWay({ ignoreTrailingSlash: true, ignoreDuplicateSlashes: true })

  const b1Path = function b1StaticPath () {}
  const b2Path = function b2StaticPath () {}
  const cPath = function cStaticPath () {}
  const paramPath = function parameterPath () {}

  findMyWay.on('GET', '/ab1', b1Path)
  findMyWay.on('GET', '/ab2', b2Path)
  findMyWay.on('GET', '/ac', cPath)
  findMyWay.on('GET', '/:pam', paramPath)

  t.equal(findMyWay.find('GET', '/ab1').handler, b1Path)
  t.equal(findMyWay.find('GET', '/ab1/').handler, b1Path)
  t.equal(findMyWay.find('GET', '//ab1').handler, b1Path)
  t.equal(findMyWay.find('GET', '//ab1//').handler, b1Path)
  t.equal(findMyWay.find('GET', '/ab2').handler, b2Path)
  t.equal(findMyWay.find('GET', '/ab2/').handler, b2Path)
  t.equal(findMyWay.find('GET', '//ab2').handler, b2Path)
  t.equal(findMyWay.find('GET', '//ab2//').handler, b2Path)
  t.equal(findMyWay.find('GET', '/ac').handler, cPath)
  t.equal(findMyWay.find('GET', '/ac/').handler, cPath)
  t.equal(findMyWay.find('GET', '//ac').handler, cPath)
  t.equal(findMyWay.find('GET', '//ac//').handler, cPath)
  t.equal(findMyWay.find('GET', '/foo').handler, paramPath)
  t.equal(findMyWay.find('GET', '/foo/').handler, paramPath)
  t.equal(findMyWay.find('GET', '//foo').handler, paramPath)
  t.equal(findMyWay.find('GET', '//foo//').handler, paramPath)

  const noTrailingSlashRet = findMyWay.find('GET', '/abcdef')
  t.equal(noTrailingSlashRet.handler, paramPath)
  t.same(noTrailingSlashRet.params, { pam: 'abcdef' })

  const trailingSlashRet = findMyWay.find('GET', '/abcdef/')
  t.equal(trailingSlashRet.handler, paramPath)
  t.same(trailingSlashRet.params, { pam: 'abcdef' })

  const noDuplicateSlashRet = findMyWay.find('GET', '/abcdef')
  t.equal(noDuplicateSlashRet.handler, paramPath)
  t.same(noDuplicateSlashRet.params, { pam: 'abcdef' })

  const duplicateSlashRet = findMyWay.find('GET', '//abcdef')
  t.equal(duplicateSlashRet.handler, paramPath)
  t.same(duplicateSlashRet.params, { pam: 'abcdef' })
})
