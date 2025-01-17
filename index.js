var once = require('once')
var eos = require('end-of-stream')
var fs = require('fs') // we only need fs to get the ReadStream and WriteStream prototypes

var noop = function () {}
var ancient = /^v?\.0/.test(process.version)

var isFn = function (fn) {
  return typeof fn === 'function'
}

var isFS = function (stream) {
  if (!ancient) return false // newer node version do not need to care about fs is a special way
  if (!fs) return false // browser
  return (stream instanceof (fs.ReadStream || noop) || stream instanceof (fs.WriteStream || noop)) && isFn(stream.close)
}

var isRequest = function (stream) {
  return stream.setHeader && isFn(stream.abort)
}

var destroyer = function (toDestroy, stream, reading, writing, callback) {
  callback = once(callback)

  var closed = false
  stream.on('close', function () {
    closed = true
  })

  var _destroy = eos(stream, {readable: reading, writable: writing}, function (err) {
    if (err) return callback(err)
    closed = true
    callback()
  })

  toDestroy.push(_destroy)

  var destroyed = false
  return function (err) {
    if (closed) return
    if (destroyed) return
    destroyed = true

    if (isFS(stream)) return stream.close(noop) // use close for fs streams to avoid fd leaks
    if (isRequest(stream)) return stream.abort() // request.destroy just do .end - .abort is what we want

    if (isFn(stream.destroy)) return stream.destroy()

    callback(err || new Error('stream was destroyed'))
  }
}

var call = function (fn) {
  fn()
}

var pipe = function (from, to) {
  return from.pipe(to)
}

class Pump {

  constructor() {
    this._toDestroy = [];
  }

  pump () {
    var streams = Array.prototype.slice.call(arguments)
    var callback = isFn(streams[streams.length - 1] || noop) && streams.pop() || noop

    if (Array.isArray(streams[0])) streams = streams[0]
    if (streams.length < 2) throw new Error('pump requires two streams per minimum')

    var self = this;
    var error
    var destroys = streams.map(function (stream, i) {
      var reading = i < streams.length - 1
      var writing = i > 0
      return destroyer(self._toDestroy, stream, reading, writing, function (err) {
        if (!error) error = err
        if (err) destroys.forEach(call)
        if (reading) return
        destroys.forEach(call)
        callback(error)
      })
    })
    
    return streams.reduce(pipe)
  }

  forceDestroy() {
    if (this._toDestroy) {
      for (const f of this._toDestroy) {
        f();
      }
    }
  }

}

module.exports = Pump
