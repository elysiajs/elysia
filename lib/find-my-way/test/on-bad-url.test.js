'use strict'

const t = require('tap')
const test = t.test
const FindMyWay = require('../')

test('If onBadUrl is defined, then a bad url should be handled differently (find)', t => {
  t.plan(1)
  const findMyWay = FindMyWay({
    defaultRoute: (req, res) => {
      t.fail('Should not be defaultRoute')
    },
    onBadUrl: (path, req, res) => {
      t.equal(path, '/%world', { todo: 'this is not executed' })
    }
  })

  findMyWay.on('GET', '/hello/:id', (req, res) => {
    t.fail('Should not be here')
  })

  const handle = findMyWay.find('GET', '/hello/%world')
  t.not(handle, null)
})

test('If onBadUrl is defined, then a bad url should be handled differently (lookup)', t => {
  t.plan(1)
  const findMyWay = FindMyWay({
    defaultRoute: (req, res) => {
      t.fail('Should not be defaultRoute')
    },
    onBadUrl: (path, req, res) => {
      t.equal(path, '/hello/%world')
    }
  })

  findMyWay.on('GET', '/hello/:id', (req, res) => {
    t.fail('Should not be here')
  })

  findMyWay.lookup({ method: 'GET', url: '/hello/%world', headers: {} }, null)
})

test('If onBadUrl is not defined, then we should call the defaultRoute (find)', t => {
  t.plan(1)
  const findMyWay = FindMyWay({
    defaultRoute: (req, res) => {
      t.fail('Should not be defaultRoute')
    }
  })

  findMyWay.on('GET', '/hello/:id', (req, res) => {
    t.fail('Should not be here')
  })

  const handle = findMyWay.find('GET', '/hello/%world')
  t.equal(handle, null)
})

test('If onBadUrl is not defined, then we should call the defaultRoute (lookup)', t => {
  t.plan(1)
  const findMyWay = FindMyWay({
    defaultRoute: (req, res) => {
      t.pass('Everything fine')
    }
  })

  findMyWay.on('GET', '/hello/:id', (req, res) => {
    t.fail('Should not be here')
  })

  findMyWay.lookup({ method: 'GET', url: '/hello/%world', headers: {} }, null)
})
