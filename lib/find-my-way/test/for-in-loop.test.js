'use strict'

/* eslint no-extend-native: off */

const t = require('tap')

// Something could extend the Array prototype
Array.prototype.test = null
t.doesNotThrow(() => {
  require('../')
})
