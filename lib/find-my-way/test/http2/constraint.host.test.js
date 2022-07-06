'use strict'

const t = require('tap')
const test = t.test
const FindMyWay = require('../..')

test('A route supports host constraints under http2 protocol', t => {
  t.plan(3)

  const findMyWay = FindMyWay()

  findMyWay.on('GET', '/', {}, (req, res) => {
    t.fail()
  })
  findMyWay.on('GET', '/', { constraints: { host: 'fastify.io' } }, (req, res) => {
    t.equal(req.headers[':authority'], 'fastify.io')
  })
  findMyWay.on('GET', '/', { constraints: { host: /.+\.de/ } }, (req, res) => {
    t.ok(req.headers[':authority'].endsWith('.de'))
  })

  findMyWay.lookup({
    method: 'GET',
    url: '/',
    headers: {
      ':authority': 'fastify.io'
    }
  })

  findMyWay.lookup({
    method: 'GET',
    url: '/',
    headers: {
      ':authority': 'fastify.de'
    }
  })

  findMyWay.lookup({
    method: 'GET',
    url: '/',
    headers: {
      ':authority': 'find-my-way.de'
    }
  })
})
