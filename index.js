var extend = require('xtend')
var hook = require('level-hookdown')
var Transform =
  require('stream').Transform || require('readable-stream').Transform
var isArray = Array.isArray

module.exports = AutoIndex

function puts (batchObj) {
  return batchObj.type === 'put'
}

function AutoIndex (db, idb, reduce) {
  if (typeof reduce !== 'function') {
    throw new Error('Reduce argument must be a string or function')
  }
  // Might be hookd alrady!  Lets use that
  var hdb = !db.prehooks && isArray(db.prehooks) ? hook(db) : db

  function index (operation, cb) {
    if (operation.type === 'put') {
      idb.put(reduce(operation.value), operation.key, cb)
    } else if (operation.type === 'del') {
      db.get(operation.key, function (err, value) {
        if (err && err.type === 'NotFoundError') {
          idb.del(reduce(operation.value), cb)
        } else if (err) {
          cb(err)
        } else {
          cb()
        }
      })
    } else if (operation.type === 'batch') {
      // todo handle dels
      var idxBatch = operation.array.filter(puts).map(function (opr) {
        if (op.type === 'put') return extend(op, {key: reduce(operation.value), value: op.key})
      })
      idb.batch(idxBatch, cb)
    }
  }

  hdb.prehooks.push(index)

  var secondary = {}

  secondary.manifest = {
    methods: {
      get: { type: 'async' },
      del: { type: 'async' },
      createValueStream: { type: 'readable' },
      createKeyStream: { type: 'readable' },
      createReadStream: { type: 'readable' }
    }
  }

  secondary.get = op('get')
  secondary.del = op('del')

  function op (type) {
    return function (key, opts, fn) {
      if (typeof opts === 'function') {
        fn = opts
        opts = {}
      }

      idb.get(key, function (err, value) {
        if (err) return fn(err)
        db[type](value, opts, fn)
      })
    }
  }

  secondary.createValueStream = function (opts) {
    (opts && opts || (opts = {})).keys = false
    return secondary.createReadStream(opts)
  }

  secondary.createKeyStream = function (opts) {
    (opts && opts || (opts = {})).values = false
    return secondary.createReadStream(opts)
  }

  secondary.createReadStream = function (opts) {
    opts = opts || {}
    var tr = Transform({ objectMode: true })

    tr._transform = function (chunk, enc, done) {
      var key = chunk.value
      if (opts.values === false) {
        done(null, key)
        return
      }

      db.get(key, function (err, value) {
        if (err && err.type === 'NotFoundError') {
          idb.del(key, done)
        } else if (err) {
          done(err)
        } else {
          emit()
        }

        function emit () {
          if (opts.keys === false) {
            done(null, value)
          } else {
            done(null, {
              key: key,
              value: value
            })
          }
        }
      })
    }

    var opts2 = extend({}, opts)
    opts2.keys = opts2.values = true
    idb.createReadStream(opts2).pipe(tr)

    return tr
  }

  return secondary
}