'use strict'

const t = require('tap')
const test = t.test
const FindMyWay = require('..')
const alpha = () => { }
const beta = () => { }
const gamma = () => { }

test('A route could support multiple host constraints while versioned', t => {
  t.plan(6)

  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/', { constraints: { host: 'fastify.io', version: '1.1.0' } }, beta)
  findMyWay.on('GET', '/', { constraints: { host: 'fastify.io', version: '2.1.0' } }, gamma)

  t.equal(findMyWay.find('GET', '/', { host: 'fastify.io', version: '1.x' }).handler, beta)
  t.equal(findMyWay.find('GET', '/', { host: 'fastify.io', version: '1.1.x' }).handler, beta)
  t.equal(findMyWay.find('GET', '/', { host: 'fastify.io', version: '2.x' }).handler, gamma)
  t.equal(findMyWay.find('GET', '/', { host: 'fastify.io', version: '2.1.x' }).handler, gamma)
  t.notOk(findMyWay.find('GET', '/', { host: 'fastify.io', version: '3.x' }))
  t.notOk(findMyWay.find('GET', '/', { host: 'something-else.io', version: '1.x' }))
})

test('Constrained routes are matched before unconstrainted routes when the constrained route is added last', t => {
  t.plan(3)

  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/', {}, alpha)
  findMyWay.on('GET', '/', { constraints: { host: 'fastify.io' } }, beta)

  t.equal(findMyWay.find('GET', '/', {}).handler, alpha)
  t.equal(findMyWay.find('GET', '/', { host: 'fastify.io' }).handler, beta)
  t.equal(findMyWay.find('GET', '/', { host: 'example.com' }).handler, alpha)
})

test('Constrained routes are matched before unconstrainted routes when the constrained route is added first', t => {
  t.plan(3)

  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/', { constraints: { host: 'fastify.io' } }, beta)
  findMyWay.on('GET', '/', {}, alpha)

  t.equal(findMyWay.find('GET', '/', {}).handler, alpha)
  t.equal(findMyWay.find('GET', '/', { host: 'fastify.io' }).handler, beta)
  t.equal(findMyWay.find('GET', '/', { host: 'example.com' }).handler, alpha)
})

test('Routes with multiple constraints are matched before routes with one constraint when the doubly-constrained route is added last', t => {
  t.plan(3)

  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/', { constraints: { host: 'fastify.io' } }, alpha)
  findMyWay.on('GET', '/', { constraints: { host: 'fastify.io', version: '1.0.0' } }, beta)

  t.equal(findMyWay.find('GET', '/', { host: 'fastify.io' }).handler, alpha)
  t.equal(findMyWay.find('GET', '/', { host: 'fastify.io', version: '1.0.0' }).handler, beta)
  t.equal(findMyWay.find('GET', '/', { host: 'fastify.io', version: '2.0.0' }), null)
})

test('Routes with multiple constraints are matched before routes with one constraint when the doubly-constrained route is added first', t => {
  t.plan(3)

  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/', { constraints: { host: 'fastify.io', version: '1.0.0' } }, beta)
  findMyWay.on('GET', '/', { constraints: { host: 'fastify.io' } }, alpha)

  t.equal(findMyWay.find('GET', '/', { host: 'fastify.io' }).handler, alpha)
  t.equal(findMyWay.find('GET', '/', { host: 'fastify.io', version: '1.0.0' }).handler, beta)
  t.equal(findMyWay.find('GET', '/', { host: 'fastify.io', version: '2.0.0' }), null)
})

test('Routes with multiple constraints are matched before routes with one constraint before unconstrained routes', t => {
  t.plan(3)

  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/', { constraints: { host: 'fastify.io', version: '1.0.0' } }, beta)
  findMyWay.on('GET', '/', { constraints: { host: 'fastify.io' } }, alpha)
  findMyWay.on('GET', '/', { constraints: {} }, gamma)

  t.equal(findMyWay.find('GET', '/', { host: 'fastify.io', version: '1.0.0' }).handler, beta)
  t.equal(findMyWay.find('GET', '/', { host: 'fastify.io', version: '2.0.0' }), null)
  t.equal(findMyWay.find('GET', '/', { host: 'example.io' }).handler, gamma)
})

test('Has constraint strategy method test', t => {
  t.plan(6)

  const findMyWay = FindMyWay()

  t.same(findMyWay.hasConstraintStrategy('version'), false)
  t.same(findMyWay.hasConstraintStrategy('host'), false)

  findMyWay.on('GET', '/', { constraints: { host: 'fastify.io' } }, () => {})

  t.same(findMyWay.hasConstraintStrategy('version'), false)
  t.same(findMyWay.hasConstraintStrategy('host'), true)

  findMyWay.on('GET', '/', { constraints: { host: 'fastify.io', version: '1.0.0' } }, () => {})

  t.same(findMyWay.hasConstraintStrategy('version'), true)
  t.same(findMyWay.hasConstraintStrategy('host'), true)
})
