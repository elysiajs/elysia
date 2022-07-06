'use strict'

const assert = require('assert')

function SemVerStore () {
  if (!(this instanceof SemVerStore)) {
    return new SemVerStore()
  }

  this.store = {}

  this.maxMajor = 0
  this.maxMinors = {}
  this.maxPatches = {}
}

SemVerStore.prototype.set = function (version, store) {
  if (typeof version !== 'string') {
    throw new TypeError('Version should be a string')
  }
  let [major, minor, patch] = version.split('.')

  major = Number(major) || 0
  minor = Number(minor) || 0
  patch = Number(patch) || 0

  if (major >= this.maxMajor) {
    this.maxMajor = major
    this.store.x = store
    this.store['*'] = store
    this.store['x.x'] = store
    this.store['x.x.x'] = store
  }

  if (minor >= (this.maxMinors[major] || 0)) {
    this.maxMinors[major] = minor
    this.store[`${major}.x`] = store
    this.store[`${major}.x.x`] = store
  }

  if (patch >= (this.store[`${major}.${minor}`] || 0)) {
    this.maxPatches[`${major}.${minor}`] = patch
    this.store[`${major}.${minor}.x`] = store
  }

  this.store[`${major}.${minor}.${patch}`] = store
  return this
}

SemVerStore.prototype.get = function (version) {
  return this.store[version]
}

module.exports = {
  name: 'version',
  mustMatchWhenDerived: true,
  storage: SemVerStore,
  validate (value) {
    assert(typeof value === 'string', 'Version should be a string')
  }
}
