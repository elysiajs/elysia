'use strict'

const t = require('tap')
const test = t.test
const FindMyWay = require('../')

test('Multi-parametric tricky path', t => {
  t.plan(6)
  const findMyWay = FindMyWay({
    defaultRoute: () => t.fail('Should not be defaultRoute')
  })

  findMyWay.on('GET', '/:param1-static-:param2', () => {})

  t.same(
    findMyWay.find('GET', '/param1-static-param2', {}).params,
    { param1: 'param1', param2: 'param2' }
  )
  t.same(
    findMyWay.find('GET', '/param1.1-param1.2-static-param2.1-param2.2', {}).params,
    { param1: 'param1.1-param1.2', param2: 'param2.1-param2.2' }
  )
  t.same(
    findMyWay.find('GET', '/param1-1-param1-2-static-param2-1-param2-2', {}).params,
    { param1: 'param1-1-param1-2', param2: 'param2-1-param2-2' }
  )
  t.same(
    findMyWay.find('GET', '/static-static-static', {}).params,
    { param1: 'static', param2: 'static' }
  )
  t.same(
    findMyWay.find('GET', '/static-static-static-static', {}).params,
    { param1: 'static', param2: 'static-static' }
  )
  t.same(
    findMyWay.find('GET', '/static-static1-static-static', {}).params,
    { param1: 'static-static1', param2: 'static' }
  )
})

test('Multi-parametric nodes with different static ending 1', t => {
  t.plan(4)
  const findMyWay = FindMyWay({
    defaultRoute: () => t.fail('Should not be defaultRoute')
  })

  const paramHandler = () => {}
  const multiParamHandler = () => {}

  findMyWay.on('GET', '/v1/foo/:code', paramHandler)
  findMyWay.on('GET', '/v1/foo/:code.png', multiParamHandler)

  t.same(findMyWay.find('GET', '/v1/foo/hello', {}).handler, paramHandler)
  t.same(findMyWay.find('GET', '/v1/foo/hello', {}).params, { code: 'hello' })

  t.same(findMyWay.find('GET', '/v1/foo/hello.png', {}).handler, multiParamHandler)
  t.same(findMyWay.find('GET', '/v1/foo/hello.png', {}).params, { code: 'hello' })
})

test('Multi-parametric nodes with different static ending 2', t => {
  t.plan(4)
  const findMyWay = FindMyWay({
    defaultRoute: () => t.fail('Should not be defaultRoute')
  })

  const jpgHandler = () => {}
  const pngHandler = () => {}

  findMyWay.on('GET', '/v1/foo/:code.jpg', jpgHandler)
  findMyWay.on('GET', '/v1/foo/:code.png', pngHandler)

  t.same(findMyWay.find('GET', '/v1/foo/hello.jpg', {}).handler, jpgHandler)
  t.same(findMyWay.find('GET', '/v1/foo/hello.jpg', {}).params, { code: 'hello' })

  t.same(findMyWay.find('GET', '/v1/foo/hello.png', {}).handler, pngHandler)
  t.same(findMyWay.find('GET', '/v1/foo/hello.png', {}).params, { code: 'hello' })
})

test('Multi-parametric nodes with different static ending 3', t => {
  t.plan(4)
  const findMyWay = FindMyWay({
    defaultRoute: () => t.fail('Should not be defaultRoute')
  })

  const jpgHandler = () => {}
  const pngHandler = () => {}

  findMyWay.on('GET', '/v1/foo/:code.jpg/bar', jpgHandler)
  findMyWay.on('GET', '/v1/foo/:code.png/bar', pngHandler)

  t.same(findMyWay.find('GET', '/v1/foo/hello.jpg/bar', {}).handler, jpgHandler)
  t.same(findMyWay.find('GET', '/v1/foo/hello.jpg/bar', {}).params, { code: 'hello' })

  t.same(findMyWay.find('GET', '/v1/foo/hello.png/bar', {}).handler, pngHandler)
  t.same(findMyWay.find('GET', '/v1/foo/hello.png/bar', {}).params, { code: 'hello' })
})

test('Multi-parametric nodes with different static ending 4', t => {
  t.plan(6)
  const findMyWay = FindMyWay({
    defaultRoute: () => t.fail('Should not be defaultRoute')
  })

  const handler = () => {}
  const jpgHandler = () => {}
  const pngHandler = () => {}

  findMyWay.on('GET', '/v1/foo/:code/bar', handler)
  findMyWay.on('GET', '/v1/foo/:code.jpg/bar', jpgHandler)
  findMyWay.on('GET', '/v1/foo/:code.png/bar', pngHandler)

  t.same(findMyWay.find('GET', '/v1/foo/hello/bar', {}).handler, handler)
  t.same(findMyWay.find('GET', '/v1/foo/hello/bar', {}).params, { code: 'hello' })

  t.same(findMyWay.find('GET', '/v1/foo/hello.jpg/bar', {}).handler, jpgHandler)
  t.same(findMyWay.find('GET', '/v1/foo/hello.jpg/bar', {}).params, { code: 'hello' })

  t.same(findMyWay.find('GET', '/v1/foo/hello.png/bar', {}).handler, pngHandler)
  t.same(findMyWay.find('GET', '/v1/foo/hello.png/bar', {}).params, { code: 'hello' })
})
