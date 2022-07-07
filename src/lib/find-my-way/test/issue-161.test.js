'use strict'

const t = require('tap')
const test = t.test
const FindMyWay = require('../')

test('Falling back for node\'s parametric brother without ignoreTrailingSlash', t => {
  t.plan(4)
  const findMyWay = FindMyWay({
    ignoreTrailingSlash: false,
    defaultRoute: (req, res) => {
      t.fail('Should not be defaultRoute')
    }
  })

  findMyWay.on('GET', '/static/param1', () => {})
  findMyWay.on('GET', '/static/param2', () => {})
  findMyWay.on('GET', '/static/:paramA/next', () => {})

  t.same(findMyWay.find('GET', '/static/param1').params, {})
  t.same(findMyWay.find('GET', '/static/param2').params, {})
  t.same(findMyWay.find('GET', '/static/paramOther/next').params, { paramA: 'paramOther' })
  t.same(findMyWay.find('GET', '/static/param1/next').params, { paramA: 'param1' })
})

test('Falling back for node\'s parametric brother with ignoreTrailingSlash', t => {
  t.plan(4)
  const findMyWay = FindMyWay({
    ignoreTrailingSlash: true,
    defaultRoute: (req, res) => {
      t.fail('Should not be defaultRoute')
    }
  })

  findMyWay.on('GET', '/static/param1', () => {})
  findMyWay.on('GET', '/static/param2', () => {})
  findMyWay.on('GET', '/static/:paramA/next', () => {})

  t.same(findMyWay.find('GET', '/static/param1').params, {})
  t.same(findMyWay.find('GET', '/static/param2').params, {})
  t.same(findMyWay.find('GET', '/static/paramOther/next').params, { paramA: 'paramOther' })
  t.same(findMyWay.find('GET', '/static/param1/next').params, { paramA: 'param1' })
})

test('Falling back for node\'s parametric brother without ignoreTrailingSlash', t => {
  t.plan(4)
  const findMyWay = FindMyWay({
    ignoreTrailingSlash: false,
    defaultRoute: (req, res) => {
      t.fail('Should not be defaultRoute')
    }
  })

  findMyWay.on('GET', '/static/param1', () => {})
  findMyWay.on('GET', '/static/param2', () => {})
  findMyWay.on('GET', '/static/:paramA/next', () => {})

  findMyWay.on('GET', '/static/param1/next/param3', () => {})
  findMyWay.on('GET', '/static/param1/next/param4', () => {})
  findMyWay.on('GET', '/static/:paramA/next/:paramB/other', () => {})

  t.same(findMyWay.find('GET', '/static/param1/next/param3').params, {})
  t.same(findMyWay.find('GET', '/static/param1/next/param4').params, {})
  t.same(findMyWay.find('GET', '/static/paramOther/next/paramOther2/other').params, { paramA: 'paramOther', paramB: 'paramOther2' })
  t.same(findMyWay.find('GET', '/static/param1/next/param3/other').params, { paramA: 'param1', paramB: 'param3' })
})

test('Falling back for node\'s parametric brother with ignoreTrailingSlash', t => {
  t.plan(4)
  const findMyWay = FindMyWay({
    ignoreTrailingSlash: true,
    defaultRoute: (req, res) => {
      t.fail('Should not be defaultRoute')
    }
  })

  findMyWay.on('GET', '/static/param1', () => {})
  findMyWay.on('GET', '/static/param2', () => {})
  findMyWay.on('GET', '/static/:paramA/next', () => {})

  findMyWay.on('GET', '/static/param1/next/param3', () => {})
  findMyWay.on('GET', '/static/param1/next/param4', () => {})
  findMyWay.on('GET', '/static/:paramA/next/:paramB/other', () => {})

  t.same(findMyWay.find('GET', '/static/param1/next/param3').params, {})
  t.same(findMyWay.find('GET', '/static/param1/next/param4').params, {})
  t.same(findMyWay.find('GET', '/static/paramOther/next/paramOther2/other').params, { paramA: 'paramOther', paramB: 'paramOther2' })
  t.same(findMyWay.find('GET', '/static/param1/next/param3/other').params, { paramA: 'param1', paramB: 'param3' })
})
