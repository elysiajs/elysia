'use strict'

const t = require('tap')
const test = t.test
const FindMyWay = require('..')
const alpha = () => { }
const beta = () => { }
const gamma = () => { }

test('A route supports multiple host constraints', t => {
  t.plan(4)

  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/', {}, alpha)
  findMyWay.on('GET', '/', { constraints: { host: 'fastify.io' } }, beta)
  findMyWay.on('GET', '/', { constraints: { host: 'example.com' } }, gamma)

  t.equal(findMyWay.find('GET', '/', {}).handler, alpha)
  t.equal(findMyWay.find('GET', '/', { host: 'something-else.io' }).handler, alpha)
  t.equal(findMyWay.find('GET', '/', { host: 'fastify.io' }).handler, beta)
  t.equal(findMyWay.find('GET', '/', { host: 'example.com' }).handler, gamma)
})

test('A route supports wildcard host constraints', t => {
  t.plan(4)

  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/', { constraints: { host: 'fastify.io' } }, beta)
  findMyWay.on('GET', '/', { constraints: { host: /.*\.fastify\.io/ } }, gamma)

  t.equal(findMyWay.find('GET', '/', { host: 'fastify.io' }).handler, beta)
  t.equal(findMyWay.find('GET', '/', { host: 'foo.fastify.io' }).handler, gamma)
  t.equal(findMyWay.find('GET', '/', { host: 'bar.fastify.io' }).handler, gamma)
  t.notOk(findMyWay.find('GET', '/', { host: 'example.com' }))
})

test('A route supports multiple host constraints (lookup)', t => {
  t.plan(4)

  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/', {}, (req, res) => {})
  findMyWay.on('GET', '/', { constraints: { host: 'fastify.io' } }, (req, res) => {
    t.equal(req.headers.host, 'fastify.io')
  })
  findMyWay.on('GET', '/', { constraints: { host: 'example.com' } }, (req, res) => {
    t.equal(req.headers.host, 'example.com')
  })
  findMyWay.on('GET', '/', { constraints: { host: /.+\.fancy\.ca/ } }, (req, res) => {
    t.ok(req.headers.host.endsWith('.fancy.ca'))
  })

  findMyWay.lookup({
    method: 'GET',
    url: '/',
    headers: { host: 'fastify.io' }
  })

  findMyWay.lookup({
    method: 'GET',
    url: '/',
    headers: { host: 'example.com' }
  })
  findMyWay.lookup({
    method: 'GET',
    url: '/',
    headers: { host: 'foo.fancy.ca' }
  })
  findMyWay.lookup({
    method: 'GET',
    url: '/',
    headers: { host: 'bar.fancy.ca' }
  })
})
