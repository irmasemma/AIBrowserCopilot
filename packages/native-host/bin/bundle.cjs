"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ../../node_modules/ws/lib/constants.js
var require_constants = __commonJS({
  "../../node_modules/ws/lib/constants.js"(exports2, module2) {
    "use strict";
    var BINARY_TYPES = ["nodebuffer", "arraybuffer", "fragments"];
    var hasBlob = typeof Blob !== "undefined";
    if (hasBlob) BINARY_TYPES.push("blob");
    module2.exports = {
      BINARY_TYPES,
      CLOSE_TIMEOUT: 3e4,
      EMPTY_BUFFER: Buffer.alloc(0),
      GUID: "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
      hasBlob,
      kForOnEventAttribute: /* @__PURE__ */ Symbol("kIsForOnEventAttribute"),
      kListener: /* @__PURE__ */ Symbol("kListener"),
      kStatusCode: /* @__PURE__ */ Symbol("status-code"),
      kWebSocket: /* @__PURE__ */ Symbol("websocket"),
      NOOP: () => {
      }
    };
  }
});

// ../../node_modules/ws/lib/buffer-util.js
var require_buffer_util = __commonJS({
  "../../node_modules/ws/lib/buffer-util.js"(exports2, module2) {
    "use strict";
    var { EMPTY_BUFFER } = require_constants();
    var FastBuffer = Buffer[Symbol.species];
    function concat(list, totalLength) {
      if (list.length === 0) return EMPTY_BUFFER;
      if (list.length === 1) return list[0];
      const target = Buffer.allocUnsafe(totalLength);
      let offset = 0;
      for (let i = 0; i < list.length; i++) {
        const buf = list[i];
        target.set(buf, offset);
        offset += buf.length;
      }
      if (offset < totalLength) {
        return new FastBuffer(target.buffer, target.byteOffset, offset);
      }
      return target;
    }
    function _mask(source, mask, output, offset, length) {
      for (let i = 0; i < length; i++) {
        output[offset + i] = source[i] ^ mask[i & 3];
      }
    }
    function _unmask(buffer2, mask) {
      for (let i = 0; i < buffer2.length; i++) {
        buffer2[i] ^= mask[i & 3];
      }
    }
    function toArrayBuffer(buf) {
      if (buf.length === buf.buffer.byteLength) {
        return buf.buffer;
      }
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
    }
    function toBuffer(data) {
      toBuffer.readOnly = true;
      if (Buffer.isBuffer(data)) return data;
      let buf;
      if (data instanceof ArrayBuffer) {
        buf = new FastBuffer(data);
      } else if (ArrayBuffer.isView(data)) {
        buf = new FastBuffer(data.buffer, data.byteOffset, data.byteLength);
      } else {
        buf = Buffer.from(data);
        toBuffer.readOnly = false;
      }
      return buf;
    }
    module2.exports = {
      concat,
      mask: _mask,
      toArrayBuffer,
      toBuffer,
      unmask: _unmask
    };
    if (!process.env.WS_NO_BUFFER_UTIL) {
      try {
        const bufferUtil = require("bufferutil");
        module2.exports.mask = function(source, mask, output, offset, length) {
          if (length < 48) _mask(source, mask, output, offset, length);
          else bufferUtil.mask(source, mask, output, offset, length);
        };
        module2.exports.unmask = function(buffer2, mask) {
          if (buffer2.length < 32) _unmask(buffer2, mask);
          else bufferUtil.unmask(buffer2, mask);
        };
      } catch (e) {
      }
    }
  }
});

// ../../node_modules/ws/lib/limiter.js
var require_limiter = __commonJS({
  "../../node_modules/ws/lib/limiter.js"(exports2, module2) {
    "use strict";
    var kDone = /* @__PURE__ */ Symbol("kDone");
    var kRun = /* @__PURE__ */ Symbol("kRun");
    var Limiter = class {
      /**
       * Creates a new `Limiter`.
       *
       * @param {Number} [concurrency=Infinity] The maximum number of jobs allowed
       *     to run concurrently
       */
      constructor(concurrency) {
        this[kDone] = () => {
          this.pending--;
          this[kRun]();
        };
        this.concurrency = concurrency || Infinity;
        this.jobs = [];
        this.pending = 0;
      }
      /**
       * Adds a job to the queue.
       *
       * @param {Function} job The job to run
       * @public
       */
      add(job) {
        this.jobs.push(job);
        this[kRun]();
      }
      /**
       * Removes a job from the queue and runs it if possible.
       *
       * @private
       */
      [kRun]() {
        if (this.pending === this.concurrency) return;
        if (this.jobs.length) {
          const job = this.jobs.shift();
          this.pending++;
          job(this[kDone]);
        }
      }
    };
    module2.exports = Limiter;
  }
});

// ../../node_modules/ws/lib/permessage-deflate.js
var require_permessage_deflate = __commonJS({
  "../../node_modules/ws/lib/permessage-deflate.js"(exports2, module2) {
    "use strict";
    var zlib = require("zlib");
    var bufferUtil = require_buffer_util();
    var Limiter = require_limiter();
    var { kStatusCode } = require_constants();
    var FastBuffer = Buffer[Symbol.species];
    var TRAILER = Buffer.from([0, 0, 255, 255]);
    var kPerMessageDeflate = /* @__PURE__ */ Symbol("permessage-deflate");
    var kTotalLength = /* @__PURE__ */ Symbol("total-length");
    var kCallback = /* @__PURE__ */ Symbol("callback");
    var kBuffers = /* @__PURE__ */ Symbol("buffers");
    var kError = /* @__PURE__ */ Symbol("error");
    var zlibLimiter;
    var PerMessageDeflate2 = class {
      /**
       * Creates a PerMessageDeflate instance.
       *
       * @param {Object} [options] Configuration options
       * @param {(Boolean|Number)} [options.clientMaxWindowBits] Advertise support
       *     for, or request, a custom client window size
       * @param {Boolean} [options.clientNoContextTakeover=false] Advertise/
       *     acknowledge disabling of client context takeover
       * @param {Number} [options.concurrencyLimit=10] The number of concurrent
       *     calls to zlib
       * @param {Boolean} [options.isServer=false] Create the instance in either
       *     server or client mode
       * @param {Number} [options.maxPayload=0] The maximum allowed message length
       * @param {(Boolean|Number)} [options.serverMaxWindowBits] Request/confirm the
       *     use of a custom server window size
       * @param {Boolean} [options.serverNoContextTakeover=false] Request/accept
       *     disabling of server context takeover
       * @param {Number} [options.threshold=1024] Size (in bytes) below which
       *     messages should not be compressed if context takeover is disabled
       * @param {Object} [options.zlibDeflateOptions] Options to pass to zlib on
       *     deflate
       * @param {Object} [options.zlibInflateOptions] Options to pass to zlib on
       *     inflate
       */
      constructor(options) {
        this._options = options || {};
        this._threshold = this._options.threshold !== void 0 ? this._options.threshold : 1024;
        this._maxPayload = this._options.maxPayload | 0;
        this._isServer = !!this._options.isServer;
        this._deflate = null;
        this._inflate = null;
        this.params = null;
        if (!zlibLimiter) {
          const concurrency = this._options.concurrencyLimit !== void 0 ? this._options.concurrencyLimit : 10;
          zlibLimiter = new Limiter(concurrency);
        }
      }
      /**
       * @type {String}
       */
      static get extensionName() {
        return "permessage-deflate";
      }
      /**
       * Create an extension negotiation offer.
       *
       * @return {Object} Extension parameters
       * @public
       */
      offer() {
        const params = {};
        if (this._options.serverNoContextTakeover) {
          params.server_no_context_takeover = true;
        }
        if (this._options.clientNoContextTakeover) {
          params.client_no_context_takeover = true;
        }
        if (this._options.serverMaxWindowBits) {
          params.server_max_window_bits = this._options.serverMaxWindowBits;
        }
        if (this._options.clientMaxWindowBits) {
          params.client_max_window_bits = this._options.clientMaxWindowBits;
        } else if (this._options.clientMaxWindowBits == null) {
          params.client_max_window_bits = true;
        }
        return params;
      }
      /**
       * Accept an extension negotiation offer/response.
       *
       * @param {Array} configurations The extension negotiation offers/reponse
       * @return {Object} Accepted configuration
       * @public
       */
      accept(configurations) {
        configurations = this.normalizeParams(configurations);
        this.params = this._isServer ? this.acceptAsServer(configurations) : this.acceptAsClient(configurations);
        return this.params;
      }
      /**
       * Releases all resources used by the extension.
       *
       * @public
       */
      cleanup() {
        if (this._inflate) {
          this._inflate.close();
          this._inflate = null;
        }
        if (this._deflate) {
          const callback = this._deflate[kCallback];
          this._deflate.close();
          this._deflate = null;
          if (callback) {
            callback(
              new Error(
                "The deflate stream was closed while data was being processed"
              )
            );
          }
        }
      }
      /**
       *  Accept an extension negotiation offer.
       *
       * @param {Array} offers The extension negotiation offers
       * @return {Object} Accepted configuration
       * @private
       */
      acceptAsServer(offers) {
        const opts = this._options;
        const accepted = offers.find((params) => {
          if (opts.serverNoContextTakeover === false && params.server_no_context_takeover || params.server_max_window_bits && (opts.serverMaxWindowBits === false || typeof opts.serverMaxWindowBits === "number" && opts.serverMaxWindowBits > params.server_max_window_bits) || typeof opts.clientMaxWindowBits === "number" && !params.client_max_window_bits) {
            return false;
          }
          return true;
        });
        if (!accepted) {
          throw new Error("None of the extension offers can be accepted");
        }
        if (opts.serverNoContextTakeover) {
          accepted.server_no_context_takeover = true;
        }
        if (opts.clientNoContextTakeover) {
          accepted.client_no_context_takeover = true;
        }
        if (typeof opts.serverMaxWindowBits === "number") {
          accepted.server_max_window_bits = opts.serverMaxWindowBits;
        }
        if (typeof opts.clientMaxWindowBits === "number") {
          accepted.client_max_window_bits = opts.clientMaxWindowBits;
        } else if (accepted.client_max_window_bits === true || opts.clientMaxWindowBits === false) {
          delete accepted.client_max_window_bits;
        }
        return accepted;
      }
      /**
       * Accept the extension negotiation response.
       *
       * @param {Array} response The extension negotiation response
       * @return {Object} Accepted configuration
       * @private
       */
      acceptAsClient(response) {
        const params = response[0];
        if (this._options.clientNoContextTakeover === false && params.client_no_context_takeover) {
          throw new Error('Unexpected parameter "client_no_context_takeover"');
        }
        if (!params.client_max_window_bits) {
          if (typeof this._options.clientMaxWindowBits === "number") {
            params.client_max_window_bits = this._options.clientMaxWindowBits;
          }
        } else if (this._options.clientMaxWindowBits === false || typeof this._options.clientMaxWindowBits === "number" && params.client_max_window_bits > this._options.clientMaxWindowBits) {
          throw new Error(
            'Unexpected or invalid parameter "client_max_window_bits"'
          );
        }
        return params;
      }
      /**
       * Normalize parameters.
       *
       * @param {Array} configurations The extension negotiation offers/reponse
       * @return {Array} The offers/response with normalized parameters
       * @private
       */
      normalizeParams(configurations) {
        configurations.forEach((params) => {
          Object.keys(params).forEach((key) => {
            let value = params[key];
            if (value.length > 1) {
              throw new Error(`Parameter "${key}" must have only a single value`);
            }
            value = value[0];
            if (key === "client_max_window_bits") {
              if (value !== true) {
                const num2 = +value;
                if (!Number.isInteger(num2) || num2 < 8 || num2 > 15) {
                  throw new TypeError(
                    `Invalid value for parameter "${key}": ${value}`
                  );
                }
                value = num2;
              } else if (!this._isServer) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
            } else if (key === "server_max_window_bits") {
              const num2 = +value;
              if (!Number.isInteger(num2) || num2 < 8 || num2 > 15) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
              value = num2;
            } else if (key === "client_no_context_takeover" || key === "server_no_context_takeover") {
              if (value !== true) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
            } else {
              throw new Error(`Unknown parameter "${key}"`);
            }
            params[key] = value;
          });
        });
        return configurations;
      }
      /**
       * Decompress data. Concurrency limited.
       *
       * @param {Buffer} data Compressed data
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @public
       */
      decompress(data, fin, callback) {
        zlibLimiter.add((done) => {
          this._decompress(data, fin, (err, result) => {
            done();
            callback(err, result);
          });
        });
      }
      /**
       * Compress data. Concurrency limited.
       *
       * @param {(Buffer|String)} data Data to compress
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @public
       */
      compress(data, fin, callback) {
        zlibLimiter.add((done) => {
          this._compress(data, fin, (err, result) => {
            done();
            callback(err, result);
          });
        });
      }
      /**
       * Decompress data.
       *
       * @param {Buffer} data Compressed data
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @private
       */
      _decompress(data, fin, callback) {
        const endpoint = this._isServer ? "client" : "server";
        if (!this._inflate) {
          const key = `${endpoint}_max_window_bits`;
          const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
          this._inflate = zlib.createInflateRaw({
            ...this._options.zlibInflateOptions,
            windowBits
          });
          this._inflate[kPerMessageDeflate] = this;
          this._inflate[kTotalLength] = 0;
          this._inflate[kBuffers] = [];
          this._inflate.on("error", inflateOnError);
          this._inflate.on("data", inflateOnData);
        }
        this._inflate[kCallback] = callback;
        this._inflate.write(data);
        if (fin) this._inflate.write(TRAILER);
        this._inflate.flush(() => {
          const err = this._inflate[kError];
          if (err) {
            this._inflate.close();
            this._inflate = null;
            callback(err);
            return;
          }
          const data2 = bufferUtil.concat(
            this._inflate[kBuffers],
            this._inflate[kTotalLength]
          );
          if (this._inflate._readableState.endEmitted) {
            this._inflate.close();
            this._inflate = null;
          } else {
            this._inflate[kTotalLength] = 0;
            this._inflate[kBuffers] = [];
            if (fin && this.params[`${endpoint}_no_context_takeover`]) {
              this._inflate.reset();
            }
          }
          callback(null, data2);
        });
      }
      /**
       * Compress data.
       *
       * @param {(Buffer|String)} data Data to compress
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @private
       */
      _compress(data, fin, callback) {
        const endpoint = this._isServer ? "server" : "client";
        if (!this._deflate) {
          const key = `${endpoint}_max_window_bits`;
          const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
          this._deflate = zlib.createDeflateRaw({
            ...this._options.zlibDeflateOptions,
            windowBits
          });
          this._deflate[kTotalLength] = 0;
          this._deflate[kBuffers] = [];
          this._deflate.on("data", deflateOnData);
        }
        this._deflate[kCallback] = callback;
        this._deflate.write(data);
        this._deflate.flush(zlib.Z_SYNC_FLUSH, () => {
          if (!this._deflate) {
            return;
          }
          let data2 = bufferUtil.concat(
            this._deflate[kBuffers],
            this._deflate[kTotalLength]
          );
          if (fin) {
            data2 = new FastBuffer(data2.buffer, data2.byteOffset, data2.length - 4);
          }
          this._deflate[kCallback] = null;
          this._deflate[kTotalLength] = 0;
          this._deflate[kBuffers] = [];
          if (fin && this.params[`${endpoint}_no_context_takeover`]) {
            this._deflate.reset();
          }
          callback(null, data2);
        });
      }
    };
    module2.exports = PerMessageDeflate2;
    function deflateOnData(chunk) {
      this[kBuffers].push(chunk);
      this[kTotalLength] += chunk.length;
    }
    function inflateOnData(chunk) {
      this[kTotalLength] += chunk.length;
      if (this[kPerMessageDeflate]._maxPayload < 1 || this[kTotalLength] <= this[kPerMessageDeflate]._maxPayload) {
        this[kBuffers].push(chunk);
        return;
      }
      this[kError] = new RangeError("Max payload size exceeded");
      this[kError].code = "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH";
      this[kError][kStatusCode] = 1009;
      this.removeListener("data", inflateOnData);
      this.reset();
    }
    function inflateOnError(err) {
      this[kPerMessageDeflate]._inflate = null;
      if (this[kError]) {
        this[kCallback](this[kError]);
        return;
      }
      err[kStatusCode] = 1007;
      this[kCallback](err);
    }
  }
});

// ../../node_modules/ws/lib/validation.js
var require_validation = __commonJS({
  "../../node_modules/ws/lib/validation.js"(exports2, module2) {
    "use strict";
    var { isUtf8 } = require("buffer");
    var { hasBlob } = require_constants();
    var tokenChars = [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 0 - 15
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 16 - 31
      0,
      1,
      0,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      1,
      1,
      0,
      1,
      1,
      0,
      // 32 - 47
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      // 48 - 63
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      // 64 - 79
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      1,
      1,
      // 80 - 95
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      // 96 - 111
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      1,
      0,
      1,
      0
      // 112 - 127
    ];
    function isValidStatusCode(code) {
      return code >= 1e3 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006 || code >= 3e3 && code <= 4999;
    }
    function _isValidUTF8(buf) {
      const len = buf.length;
      let i = 0;
      while (i < len) {
        if ((buf[i] & 128) === 0) {
          i++;
        } else if ((buf[i] & 224) === 192) {
          if (i + 1 === len || (buf[i + 1] & 192) !== 128 || (buf[i] & 254) === 192) {
            return false;
          }
          i += 2;
        } else if ((buf[i] & 240) === 224) {
          if (i + 2 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || buf[i] === 224 && (buf[i + 1] & 224) === 128 || // Overlong
          buf[i] === 237 && (buf[i + 1] & 224) === 160) {
            return false;
          }
          i += 3;
        } else if ((buf[i] & 248) === 240) {
          if (i + 3 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || (buf[i + 3] & 192) !== 128 || buf[i] === 240 && (buf[i + 1] & 240) === 128 || // Overlong
          buf[i] === 244 && buf[i + 1] > 143 || buf[i] > 244) {
            return false;
          }
          i += 4;
        } else {
          return false;
        }
      }
      return true;
    }
    function isBlob(value) {
      return hasBlob && typeof value === "object" && typeof value.arrayBuffer === "function" && typeof value.type === "string" && typeof value.stream === "function" && (value[Symbol.toStringTag] === "Blob" || value[Symbol.toStringTag] === "File");
    }
    module2.exports = {
      isBlob,
      isValidStatusCode,
      isValidUTF8: _isValidUTF8,
      tokenChars
    };
    if (isUtf8) {
      module2.exports.isValidUTF8 = function(buf) {
        return buf.length < 24 ? _isValidUTF8(buf) : isUtf8(buf);
      };
    } else if (!process.env.WS_NO_UTF_8_VALIDATE) {
      try {
        const isValidUTF8 = require("utf-8-validate");
        module2.exports.isValidUTF8 = function(buf) {
          return buf.length < 32 ? _isValidUTF8(buf) : isValidUTF8(buf);
        };
      } catch (e) {
      }
    }
  }
});

// ../../node_modules/ws/lib/receiver.js
var require_receiver = __commonJS({
  "../../node_modules/ws/lib/receiver.js"(exports2, module2) {
    "use strict";
    var { Writable } = require("stream");
    var PerMessageDeflate2 = require_permessage_deflate();
    var {
      BINARY_TYPES,
      EMPTY_BUFFER,
      kStatusCode,
      kWebSocket
    } = require_constants();
    var { concat, toArrayBuffer, unmask } = require_buffer_util();
    var { isValidStatusCode, isValidUTF8 } = require_validation();
    var FastBuffer = Buffer[Symbol.species];
    var GET_INFO = 0;
    var GET_PAYLOAD_LENGTH_16 = 1;
    var GET_PAYLOAD_LENGTH_64 = 2;
    var GET_MASK = 3;
    var GET_DATA = 4;
    var INFLATING = 5;
    var DEFER_EVENT = 6;
    var Receiver2 = class extends Writable {
      /**
       * Creates a Receiver instance.
       *
       * @param {Object} [options] Options object
       * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {String} [options.binaryType=nodebuffer] The type for binary data
       * @param {Object} [options.extensions] An object containing the negotiated
       *     extensions
       * @param {Boolean} [options.isServer=false] Specifies whether to operate in
       *     client or server mode
       * @param {Number} [options.maxPayload=0] The maximum allowed message length
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       */
      constructor(options = {}) {
        super();
        this._allowSynchronousEvents = options.allowSynchronousEvents !== void 0 ? options.allowSynchronousEvents : true;
        this._binaryType = options.binaryType || BINARY_TYPES[0];
        this._extensions = options.extensions || {};
        this._isServer = !!options.isServer;
        this._maxPayload = options.maxPayload | 0;
        this._skipUTF8Validation = !!options.skipUTF8Validation;
        this[kWebSocket] = void 0;
        this._bufferedBytes = 0;
        this._buffers = [];
        this._compressed = false;
        this._payloadLength = 0;
        this._mask = void 0;
        this._fragmented = 0;
        this._masked = false;
        this._fin = false;
        this._opcode = 0;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._fragments = [];
        this._errored = false;
        this._loop = false;
        this._state = GET_INFO;
      }
      /**
       * Implements `Writable.prototype._write()`.
       *
       * @param {Buffer} chunk The chunk of data to write
       * @param {String} encoding The character encoding of `chunk`
       * @param {Function} cb Callback
       * @private
       */
      _write(chunk, encoding, cb) {
        if (this._opcode === 8 && this._state == GET_INFO) return cb();
        this._bufferedBytes += chunk.length;
        this._buffers.push(chunk);
        this.startLoop(cb);
      }
      /**
       * Consumes `n` bytes from the buffered data.
       *
       * @param {Number} n The number of bytes to consume
       * @return {Buffer} The consumed bytes
       * @private
       */
      consume(n) {
        this._bufferedBytes -= n;
        if (n === this._buffers[0].length) return this._buffers.shift();
        if (n < this._buffers[0].length) {
          const buf = this._buffers[0];
          this._buffers[0] = new FastBuffer(
            buf.buffer,
            buf.byteOffset + n,
            buf.length - n
          );
          return new FastBuffer(buf.buffer, buf.byteOffset, n);
        }
        const dst = Buffer.allocUnsafe(n);
        do {
          const buf = this._buffers[0];
          const offset = dst.length - n;
          if (n >= buf.length) {
            dst.set(this._buffers.shift(), offset);
          } else {
            dst.set(new Uint8Array(buf.buffer, buf.byteOffset, n), offset);
            this._buffers[0] = new FastBuffer(
              buf.buffer,
              buf.byteOffset + n,
              buf.length - n
            );
          }
          n -= buf.length;
        } while (n > 0);
        return dst;
      }
      /**
       * Starts the parsing loop.
       *
       * @param {Function} cb Callback
       * @private
       */
      startLoop(cb) {
        this._loop = true;
        do {
          switch (this._state) {
            case GET_INFO:
              this.getInfo(cb);
              break;
            case GET_PAYLOAD_LENGTH_16:
              this.getPayloadLength16(cb);
              break;
            case GET_PAYLOAD_LENGTH_64:
              this.getPayloadLength64(cb);
              break;
            case GET_MASK:
              this.getMask();
              break;
            case GET_DATA:
              this.getData(cb);
              break;
            case INFLATING:
            case DEFER_EVENT:
              this._loop = false;
              return;
          }
        } while (this._loop);
        if (!this._errored) cb();
      }
      /**
       * Reads the first two bytes of a frame.
       *
       * @param {Function} cb Callback
       * @private
       */
      getInfo(cb) {
        if (this._bufferedBytes < 2) {
          this._loop = false;
          return;
        }
        const buf = this.consume(2);
        if ((buf[0] & 48) !== 0) {
          const error = this.createError(
            RangeError,
            "RSV2 and RSV3 must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_RSV_2_3"
          );
          cb(error);
          return;
        }
        const compressed = (buf[0] & 64) === 64;
        if (compressed && !this._extensions[PerMessageDeflate2.extensionName]) {
          const error = this.createError(
            RangeError,
            "RSV1 must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_RSV_1"
          );
          cb(error);
          return;
        }
        this._fin = (buf[0] & 128) === 128;
        this._opcode = buf[0] & 15;
        this._payloadLength = buf[1] & 127;
        if (this._opcode === 0) {
          if (compressed) {
            const error = this.createError(
              RangeError,
              "RSV1 must be clear",
              true,
              1002,
              "WS_ERR_UNEXPECTED_RSV_1"
            );
            cb(error);
            return;
          }
          if (!this._fragmented) {
            const error = this.createError(
              RangeError,
              "invalid opcode 0",
              true,
              1002,
              "WS_ERR_INVALID_OPCODE"
            );
            cb(error);
            return;
          }
          this._opcode = this._fragmented;
        } else if (this._opcode === 1 || this._opcode === 2) {
          if (this._fragmented) {
            const error = this.createError(
              RangeError,
              `invalid opcode ${this._opcode}`,
              true,
              1002,
              "WS_ERR_INVALID_OPCODE"
            );
            cb(error);
            return;
          }
          this._compressed = compressed;
        } else if (this._opcode > 7 && this._opcode < 11) {
          if (!this._fin) {
            const error = this.createError(
              RangeError,
              "FIN must be set",
              true,
              1002,
              "WS_ERR_EXPECTED_FIN"
            );
            cb(error);
            return;
          }
          if (compressed) {
            const error = this.createError(
              RangeError,
              "RSV1 must be clear",
              true,
              1002,
              "WS_ERR_UNEXPECTED_RSV_1"
            );
            cb(error);
            return;
          }
          if (this._payloadLength > 125 || this._opcode === 8 && this._payloadLength === 1) {
            const error = this.createError(
              RangeError,
              `invalid payload length ${this._payloadLength}`,
              true,
              1002,
              "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH"
            );
            cb(error);
            return;
          }
        } else {
          const error = this.createError(
            RangeError,
            `invalid opcode ${this._opcode}`,
            true,
            1002,
            "WS_ERR_INVALID_OPCODE"
          );
          cb(error);
          return;
        }
        if (!this._fin && !this._fragmented) this._fragmented = this._opcode;
        this._masked = (buf[1] & 128) === 128;
        if (this._isServer) {
          if (!this._masked) {
            const error = this.createError(
              RangeError,
              "MASK must be set",
              true,
              1002,
              "WS_ERR_EXPECTED_MASK"
            );
            cb(error);
            return;
          }
        } else if (this._masked) {
          const error = this.createError(
            RangeError,
            "MASK must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_MASK"
          );
          cb(error);
          return;
        }
        if (this._payloadLength === 126) this._state = GET_PAYLOAD_LENGTH_16;
        else if (this._payloadLength === 127) this._state = GET_PAYLOAD_LENGTH_64;
        else this.haveLength(cb);
      }
      /**
       * Gets extended payload length (7+16).
       *
       * @param {Function} cb Callback
       * @private
       */
      getPayloadLength16(cb) {
        if (this._bufferedBytes < 2) {
          this._loop = false;
          return;
        }
        this._payloadLength = this.consume(2).readUInt16BE(0);
        this.haveLength(cb);
      }
      /**
       * Gets extended payload length (7+64).
       *
       * @param {Function} cb Callback
       * @private
       */
      getPayloadLength64(cb) {
        if (this._bufferedBytes < 8) {
          this._loop = false;
          return;
        }
        const buf = this.consume(8);
        const num2 = buf.readUInt32BE(0);
        if (num2 > Math.pow(2, 53 - 32) - 1) {
          const error = this.createError(
            RangeError,
            "Unsupported WebSocket frame: payload length > 2^53 - 1",
            false,
            1009,
            "WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH"
          );
          cb(error);
          return;
        }
        this._payloadLength = num2 * Math.pow(2, 32) + buf.readUInt32BE(4);
        this.haveLength(cb);
      }
      /**
       * Payload length has been read.
       *
       * @param {Function} cb Callback
       * @private
       */
      haveLength(cb) {
        if (this._payloadLength && this._opcode < 8) {
          this._totalPayloadLength += this._payloadLength;
          if (this._totalPayloadLength > this._maxPayload && this._maxPayload > 0) {
            const error = this.createError(
              RangeError,
              "Max payload size exceeded",
              false,
              1009,
              "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
            );
            cb(error);
            return;
          }
        }
        if (this._masked) this._state = GET_MASK;
        else this._state = GET_DATA;
      }
      /**
       * Reads mask bytes.
       *
       * @private
       */
      getMask() {
        if (this._bufferedBytes < 4) {
          this._loop = false;
          return;
        }
        this._mask = this.consume(4);
        this._state = GET_DATA;
      }
      /**
       * Reads data bytes.
       *
       * @param {Function} cb Callback
       * @private
       */
      getData(cb) {
        let data = EMPTY_BUFFER;
        if (this._payloadLength) {
          if (this._bufferedBytes < this._payloadLength) {
            this._loop = false;
            return;
          }
          data = this.consume(this._payloadLength);
          if (this._masked && (this._mask[0] | this._mask[1] | this._mask[2] | this._mask[3]) !== 0) {
            unmask(data, this._mask);
          }
        }
        if (this._opcode > 7) {
          this.controlMessage(data, cb);
          return;
        }
        if (this._compressed) {
          this._state = INFLATING;
          this.decompress(data, cb);
          return;
        }
        if (data.length) {
          this._messageLength = this._totalPayloadLength;
          this._fragments.push(data);
        }
        this.dataMessage(cb);
      }
      /**
       * Decompresses data.
       *
       * @param {Buffer} data Compressed data
       * @param {Function} cb Callback
       * @private
       */
      decompress(data, cb) {
        const perMessageDeflate = this._extensions[PerMessageDeflate2.extensionName];
        perMessageDeflate.decompress(data, this._fin, (err, buf) => {
          if (err) return cb(err);
          if (buf.length) {
            this._messageLength += buf.length;
            if (this._messageLength > this._maxPayload && this._maxPayload > 0) {
              const error = this.createError(
                RangeError,
                "Max payload size exceeded",
                false,
                1009,
                "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
              );
              cb(error);
              return;
            }
            this._fragments.push(buf);
          }
          this.dataMessage(cb);
          if (this._state === GET_INFO) this.startLoop(cb);
        });
      }
      /**
       * Handles a data message.
       *
       * @param {Function} cb Callback
       * @private
       */
      dataMessage(cb) {
        if (!this._fin) {
          this._state = GET_INFO;
          return;
        }
        const messageLength = this._messageLength;
        const fragments = this._fragments;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._fragmented = 0;
        this._fragments = [];
        if (this._opcode === 2) {
          let data;
          if (this._binaryType === "nodebuffer") {
            data = concat(fragments, messageLength);
          } else if (this._binaryType === "arraybuffer") {
            data = toArrayBuffer(concat(fragments, messageLength));
          } else if (this._binaryType === "blob") {
            data = new Blob(fragments);
          } else {
            data = fragments;
          }
          if (this._allowSynchronousEvents) {
            this.emit("message", data, true);
            this._state = GET_INFO;
          } else {
            this._state = DEFER_EVENT;
            setImmediate(() => {
              this.emit("message", data, true);
              this._state = GET_INFO;
              this.startLoop(cb);
            });
          }
        } else {
          const buf = concat(fragments, messageLength);
          if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
            const error = this.createError(
              Error,
              "invalid UTF-8 sequence",
              true,
              1007,
              "WS_ERR_INVALID_UTF8"
            );
            cb(error);
            return;
          }
          if (this._state === INFLATING || this._allowSynchronousEvents) {
            this.emit("message", buf, false);
            this._state = GET_INFO;
          } else {
            this._state = DEFER_EVENT;
            setImmediate(() => {
              this.emit("message", buf, false);
              this._state = GET_INFO;
              this.startLoop(cb);
            });
          }
        }
      }
      /**
       * Handles a control message.
       *
       * @param {Buffer} data Data to handle
       * @return {(Error|RangeError|undefined)} A possible error
       * @private
       */
      controlMessage(data, cb) {
        if (this._opcode === 8) {
          if (data.length === 0) {
            this._loop = false;
            this.emit("conclude", 1005, EMPTY_BUFFER);
            this.end();
          } else {
            const code = data.readUInt16BE(0);
            if (!isValidStatusCode(code)) {
              const error = this.createError(
                RangeError,
                `invalid status code ${code}`,
                true,
                1002,
                "WS_ERR_INVALID_CLOSE_CODE"
              );
              cb(error);
              return;
            }
            const buf = new FastBuffer(
              data.buffer,
              data.byteOffset + 2,
              data.length - 2
            );
            if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
              const error = this.createError(
                Error,
                "invalid UTF-8 sequence",
                true,
                1007,
                "WS_ERR_INVALID_UTF8"
              );
              cb(error);
              return;
            }
            this._loop = false;
            this.emit("conclude", code, buf);
            this.end();
          }
          this._state = GET_INFO;
          return;
        }
        if (this._allowSynchronousEvents) {
          this.emit(this._opcode === 9 ? "ping" : "pong", data);
          this._state = GET_INFO;
        } else {
          this._state = DEFER_EVENT;
          setImmediate(() => {
            this.emit(this._opcode === 9 ? "ping" : "pong", data);
            this._state = GET_INFO;
            this.startLoop(cb);
          });
        }
      }
      /**
       * Builds an error object.
       *
       * @param {function(new:Error|RangeError)} ErrorCtor The error constructor
       * @param {String} message The error message
       * @param {Boolean} prefix Specifies whether or not to add a default prefix to
       *     `message`
       * @param {Number} statusCode The status code
       * @param {String} errorCode The exposed error code
       * @return {(Error|RangeError)} The error
       * @private
       */
      createError(ErrorCtor, message, prefix, statusCode, errorCode) {
        this._loop = false;
        this._errored = true;
        const err = new ErrorCtor(
          prefix ? `Invalid WebSocket frame: ${message}` : message
        );
        Error.captureStackTrace(err, this.createError);
        err.code = errorCode;
        err[kStatusCode] = statusCode;
        return err;
      }
    };
    module2.exports = Receiver2;
  }
});

// ../../node_modules/ws/lib/sender.js
var require_sender = __commonJS({
  "../../node_modules/ws/lib/sender.js"(exports2, module2) {
    "use strict";
    var { Duplex } = require("stream");
    var { randomFillSync } = require("crypto");
    var PerMessageDeflate2 = require_permessage_deflate();
    var { EMPTY_BUFFER, kWebSocket, NOOP } = require_constants();
    var { isBlob, isValidStatusCode } = require_validation();
    var { mask: applyMask, toBuffer } = require_buffer_util();
    var kByteLength = /* @__PURE__ */ Symbol("kByteLength");
    var maskBuffer = Buffer.alloc(4);
    var RANDOM_POOL_SIZE = 8 * 1024;
    var randomPool;
    var randomPoolPointer = RANDOM_POOL_SIZE;
    var DEFAULT = 0;
    var DEFLATING = 1;
    var GET_BLOB_DATA = 2;
    var Sender2 = class _Sender {
      /**
       * Creates a Sender instance.
       *
       * @param {Duplex} socket The connection socket
       * @param {Object} [extensions] An object containing the negotiated extensions
       * @param {Function} [generateMask] The function used to generate the masking
       *     key
       */
      constructor(socket, extensions, generateMask) {
        this._extensions = extensions || {};
        if (generateMask) {
          this._generateMask = generateMask;
          this._maskBuffer = Buffer.alloc(4);
        }
        this._socket = socket;
        this._firstFragment = true;
        this._compress = false;
        this._bufferedBytes = 0;
        this._queue = [];
        this._state = DEFAULT;
        this.onerror = NOOP;
        this[kWebSocket] = void 0;
      }
      /**
       * Frames a piece of data according to the HyBi WebSocket protocol.
       *
       * @param {(Buffer|String)} data The data to frame
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @return {(Buffer|String)[]} The framed data
       * @public
       */
      static frame(data, options) {
        let mask;
        let merge = false;
        let offset = 2;
        let skipMasking = false;
        if (options.mask) {
          mask = options.maskBuffer || maskBuffer;
          if (options.generateMask) {
            options.generateMask(mask);
          } else {
            if (randomPoolPointer === RANDOM_POOL_SIZE) {
              if (randomPool === void 0) {
                randomPool = Buffer.alloc(RANDOM_POOL_SIZE);
              }
              randomFillSync(randomPool, 0, RANDOM_POOL_SIZE);
              randomPoolPointer = 0;
            }
            mask[0] = randomPool[randomPoolPointer++];
            mask[1] = randomPool[randomPoolPointer++];
            mask[2] = randomPool[randomPoolPointer++];
            mask[3] = randomPool[randomPoolPointer++];
          }
          skipMasking = (mask[0] | mask[1] | mask[2] | mask[3]) === 0;
          offset = 6;
        }
        let dataLength;
        if (typeof data === "string") {
          if ((!options.mask || skipMasking) && options[kByteLength] !== void 0) {
            dataLength = options[kByteLength];
          } else {
            data = Buffer.from(data);
            dataLength = data.length;
          }
        } else {
          dataLength = data.length;
          merge = options.mask && options.readOnly && !skipMasking;
        }
        let payloadLength = dataLength;
        if (dataLength >= 65536) {
          offset += 8;
          payloadLength = 127;
        } else if (dataLength > 125) {
          offset += 2;
          payloadLength = 126;
        }
        const target = Buffer.allocUnsafe(merge ? dataLength + offset : offset);
        target[0] = options.fin ? options.opcode | 128 : options.opcode;
        if (options.rsv1) target[0] |= 64;
        target[1] = payloadLength;
        if (payloadLength === 126) {
          target.writeUInt16BE(dataLength, 2);
        } else if (payloadLength === 127) {
          target[2] = target[3] = 0;
          target.writeUIntBE(dataLength, 4, 6);
        }
        if (!options.mask) return [target, data];
        target[1] |= 128;
        target[offset - 4] = mask[0];
        target[offset - 3] = mask[1];
        target[offset - 2] = mask[2];
        target[offset - 1] = mask[3];
        if (skipMasking) return [target, data];
        if (merge) {
          applyMask(data, mask, target, offset, dataLength);
          return [target];
        }
        applyMask(data, mask, data, 0, dataLength);
        return [target, data];
      }
      /**
       * Sends a close message to the other peer.
       *
       * @param {Number} [code] The status code component of the body
       * @param {(String|Buffer)} [data] The message component of the body
       * @param {Boolean} [mask=false] Specifies whether or not to mask the message
       * @param {Function} [cb] Callback
       * @public
       */
      close(code, data, mask, cb) {
        let buf;
        if (code === void 0) {
          buf = EMPTY_BUFFER;
        } else if (typeof code !== "number" || !isValidStatusCode(code)) {
          throw new TypeError("First argument must be a valid error code number");
        } else if (data === void 0 || !data.length) {
          buf = Buffer.allocUnsafe(2);
          buf.writeUInt16BE(code, 0);
        } else {
          const length = Buffer.byteLength(data);
          if (length > 123) {
            throw new RangeError("The message must not be greater than 123 bytes");
          }
          buf = Buffer.allocUnsafe(2 + length);
          buf.writeUInt16BE(code, 0);
          if (typeof data === "string") {
            buf.write(data, 2);
          } else {
            buf.set(data, 2);
          }
        }
        const options = {
          [kByteLength]: buf.length,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 8,
          readOnly: false,
          rsv1: false
        };
        if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, buf, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(buf, options), cb);
        }
      }
      /**
       * Sends a ping message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback
       * @public
       */
      ping(data, mask, cb) {
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (byteLength > 125) {
          throw new RangeError("The data size must not be greater than 125 bytes");
        }
        const options = {
          [kByteLength]: byteLength,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 9,
          readOnly,
          rsv1: false
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, false, options, cb]);
          } else {
            this.getBlobData(data, false, options, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(data, options), cb);
        }
      }
      /**
       * Sends a pong message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback
       * @public
       */
      pong(data, mask, cb) {
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (byteLength > 125) {
          throw new RangeError("The data size must not be greater than 125 bytes");
        }
        const options = {
          [kByteLength]: byteLength,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 10,
          readOnly,
          rsv1: false
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, false, options, cb]);
          } else {
            this.getBlobData(data, false, options, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(data, options), cb);
        }
      }
      /**
       * Sends a data message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Object} options Options object
       * @param {Boolean} [options.binary=false] Specifies whether `data` is binary
       *     or text
       * @param {Boolean} [options.compress=false] Specifies whether or not to
       *     compress `data`
       * @param {Boolean} [options.fin=false] Specifies whether the fragment is the
       *     last one
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Function} [cb] Callback
       * @public
       */
      send(data, options, cb) {
        const perMessageDeflate = this._extensions[PerMessageDeflate2.extensionName];
        let opcode = options.binary ? 2 : 1;
        let rsv1 = options.compress;
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (this._firstFragment) {
          this._firstFragment = false;
          if (rsv1 && perMessageDeflate && perMessageDeflate.params[perMessageDeflate._isServer ? "server_no_context_takeover" : "client_no_context_takeover"]) {
            rsv1 = byteLength >= perMessageDeflate._threshold;
          }
          this._compress = rsv1;
        } else {
          rsv1 = false;
          opcode = 0;
        }
        if (options.fin) this._firstFragment = true;
        const opts = {
          [kByteLength]: byteLength,
          fin: options.fin,
          generateMask: this._generateMask,
          mask: options.mask,
          maskBuffer: this._maskBuffer,
          opcode,
          readOnly,
          rsv1
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, this._compress, opts, cb]);
          } else {
            this.getBlobData(data, this._compress, opts, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, this._compress, opts, cb]);
        } else {
          this.dispatch(data, this._compress, opts, cb);
        }
      }
      /**
       * Gets the contents of a blob as binary data.
       *
       * @param {Blob} blob The blob
       * @param {Boolean} [compress=false] Specifies whether or not to compress
       *     the data
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @param {Function} [cb] Callback
       * @private
       */
      getBlobData(blob, compress, options, cb) {
        this._bufferedBytes += options[kByteLength];
        this._state = GET_BLOB_DATA;
        blob.arrayBuffer().then((arrayBuffer) => {
          if (this._socket.destroyed) {
            const err = new Error(
              "The socket was closed while the blob was being read"
            );
            process.nextTick(callCallbacks, this, err, cb);
            return;
          }
          this._bufferedBytes -= options[kByteLength];
          const data = toBuffer(arrayBuffer);
          if (!compress) {
            this._state = DEFAULT;
            this.sendFrame(_Sender.frame(data, options), cb);
            this.dequeue();
          } else {
            this.dispatch(data, compress, options, cb);
          }
        }).catch((err) => {
          process.nextTick(onError, this, err, cb);
        });
      }
      /**
       * Dispatches a message.
       *
       * @param {(Buffer|String)} data The message to send
       * @param {Boolean} [compress=false] Specifies whether or not to compress
       *     `data`
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @param {Function} [cb] Callback
       * @private
       */
      dispatch(data, compress, options, cb) {
        if (!compress) {
          this.sendFrame(_Sender.frame(data, options), cb);
          return;
        }
        const perMessageDeflate = this._extensions[PerMessageDeflate2.extensionName];
        this._bufferedBytes += options[kByteLength];
        this._state = DEFLATING;
        perMessageDeflate.compress(data, options.fin, (_, buf) => {
          if (this._socket.destroyed) {
            const err = new Error(
              "The socket was closed while data was being compressed"
            );
            callCallbacks(this, err, cb);
            return;
          }
          this._bufferedBytes -= options[kByteLength];
          this._state = DEFAULT;
          options.readOnly = false;
          this.sendFrame(_Sender.frame(buf, options), cb);
          this.dequeue();
        });
      }
      /**
       * Executes queued send operations.
       *
       * @private
       */
      dequeue() {
        while (this._state === DEFAULT && this._queue.length) {
          const params = this._queue.shift();
          this._bufferedBytes -= params[3][kByteLength];
          Reflect.apply(params[0], this, params.slice(1));
        }
      }
      /**
       * Enqueues a send operation.
       *
       * @param {Array} params Send operation parameters.
       * @private
       */
      enqueue(params) {
        this._bufferedBytes += params[3][kByteLength];
        this._queue.push(params);
      }
      /**
       * Sends a frame.
       *
       * @param {(Buffer | String)[]} list The frame to send
       * @param {Function} [cb] Callback
       * @private
       */
      sendFrame(list, cb) {
        if (list.length === 2) {
          this._socket.cork();
          this._socket.write(list[0]);
          this._socket.write(list[1], cb);
          this._socket.uncork();
        } else {
          this._socket.write(list[0], cb);
        }
      }
    };
    module2.exports = Sender2;
    function callCallbacks(sender, err, cb) {
      if (typeof cb === "function") cb(err);
      for (let i = 0; i < sender._queue.length; i++) {
        const params = sender._queue[i];
        const callback = params[params.length - 1];
        if (typeof callback === "function") callback(err);
      }
    }
    function onError(sender, err, cb) {
      callCallbacks(sender, err, cb);
      sender.onerror(err);
    }
  }
});

// ../../node_modules/ws/lib/event-target.js
var require_event_target = __commonJS({
  "../../node_modules/ws/lib/event-target.js"(exports2, module2) {
    "use strict";
    var { kForOnEventAttribute, kListener } = require_constants();
    var kCode = /* @__PURE__ */ Symbol("kCode");
    var kData = /* @__PURE__ */ Symbol("kData");
    var kError = /* @__PURE__ */ Symbol("kError");
    var kMessage = /* @__PURE__ */ Symbol("kMessage");
    var kReason = /* @__PURE__ */ Symbol("kReason");
    var kTarget = /* @__PURE__ */ Symbol("kTarget");
    var kType = /* @__PURE__ */ Symbol("kType");
    var kWasClean = /* @__PURE__ */ Symbol("kWasClean");
    var Event = class {
      /**
       * Create a new `Event`.
       *
       * @param {String} type The name of the event
       * @throws {TypeError} If the `type` argument is not specified
       */
      constructor(type) {
        this[kTarget] = null;
        this[kType] = type;
      }
      /**
       * @type {*}
       */
      get target() {
        return this[kTarget];
      }
      /**
       * @type {String}
       */
      get type() {
        return this[kType];
      }
    };
    Object.defineProperty(Event.prototype, "target", { enumerable: true });
    Object.defineProperty(Event.prototype, "type", { enumerable: true });
    var CloseEvent = class extends Event {
      /**
       * Create a new `CloseEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {Number} [options.code=0] The status code explaining why the
       *     connection was closed
       * @param {String} [options.reason=''] A human-readable string explaining why
       *     the connection was closed
       * @param {Boolean} [options.wasClean=false] Indicates whether or not the
       *     connection was cleanly closed
       */
      constructor(type, options = {}) {
        super(type);
        this[kCode] = options.code === void 0 ? 0 : options.code;
        this[kReason] = options.reason === void 0 ? "" : options.reason;
        this[kWasClean] = options.wasClean === void 0 ? false : options.wasClean;
      }
      /**
       * @type {Number}
       */
      get code() {
        return this[kCode];
      }
      /**
       * @type {String}
       */
      get reason() {
        return this[kReason];
      }
      /**
       * @type {Boolean}
       */
      get wasClean() {
        return this[kWasClean];
      }
    };
    Object.defineProperty(CloseEvent.prototype, "code", { enumerable: true });
    Object.defineProperty(CloseEvent.prototype, "reason", { enumerable: true });
    Object.defineProperty(CloseEvent.prototype, "wasClean", { enumerable: true });
    var ErrorEvent = class extends Event {
      /**
       * Create a new `ErrorEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {*} [options.error=null] The error that generated this event
       * @param {String} [options.message=''] The error message
       */
      constructor(type, options = {}) {
        super(type);
        this[kError] = options.error === void 0 ? null : options.error;
        this[kMessage] = options.message === void 0 ? "" : options.message;
      }
      /**
       * @type {*}
       */
      get error() {
        return this[kError];
      }
      /**
       * @type {String}
       */
      get message() {
        return this[kMessage];
      }
    };
    Object.defineProperty(ErrorEvent.prototype, "error", { enumerable: true });
    Object.defineProperty(ErrorEvent.prototype, "message", { enumerable: true });
    var MessageEvent = class extends Event {
      /**
       * Create a new `MessageEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {*} [options.data=null] The message content
       */
      constructor(type, options = {}) {
        super(type);
        this[kData] = options.data === void 0 ? null : options.data;
      }
      /**
       * @type {*}
       */
      get data() {
        return this[kData];
      }
    };
    Object.defineProperty(MessageEvent.prototype, "data", { enumerable: true });
    var EventTarget = {
      /**
       * Register an event listener.
       *
       * @param {String} type A string representing the event type to listen for
       * @param {(Function|Object)} handler The listener to add
       * @param {Object} [options] An options object specifies characteristics about
       *     the event listener
       * @param {Boolean} [options.once=false] A `Boolean` indicating that the
       *     listener should be invoked at most once after being added. If `true`,
       *     the listener would be automatically removed when invoked.
       * @public
       */
      addEventListener(type, handler, options = {}) {
        for (const listener of this.listeners(type)) {
          if (!options[kForOnEventAttribute] && listener[kListener] === handler && !listener[kForOnEventAttribute]) {
            return;
          }
        }
        let wrapper;
        if (type === "message") {
          wrapper = function onMessage(data, isBinary) {
            const event = new MessageEvent("message", {
              data: isBinary ? data : data.toString()
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "close") {
          wrapper = function onClose(code, message) {
            const event = new CloseEvent("close", {
              code,
              reason: message.toString(),
              wasClean: this._closeFrameReceived && this._closeFrameSent
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "error") {
          wrapper = function onError(error) {
            const event = new ErrorEvent("error", {
              error,
              message: error.message
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "open") {
          wrapper = function onOpen() {
            const event = new Event("open");
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else {
          return;
        }
        wrapper[kForOnEventAttribute] = !!options[kForOnEventAttribute];
        wrapper[kListener] = handler;
        if (options.once) {
          this.once(type, wrapper);
        } else {
          this.on(type, wrapper);
        }
      },
      /**
       * Remove an event listener.
       *
       * @param {String} type A string representing the event type to remove
       * @param {(Function|Object)} handler The listener to remove
       * @public
       */
      removeEventListener(type, handler) {
        for (const listener of this.listeners(type)) {
          if (listener[kListener] === handler && !listener[kForOnEventAttribute]) {
            this.removeListener(type, listener);
            break;
          }
        }
      }
    };
    module2.exports = {
      CloseEvent,
      ErrorEvent,
      Event,
      EventTarget,
      MessageEvent
    };
    function callListener(listener, thisArg, event) {
      if (typeof listener === "object" && listener.handleEvent) {
        listener.handleEvent.call(listener, event);
      } else {
        listener.call(thisArg, event);
      }
    }
  }
});

// ../../node_modules/ws/lib/extension.js
var require_extension = __commonJS({
  "../../node_modules/ws/lib/extension.js"(exports2, module2) {
    "use strict";
    var { tokenChars } = require_validation();
    function push(dest, name, elem) {
      if (dest[name] === void 0) dest[name] = [elem];
      else dest[name].push(elem);
    }
    function parse(header) {
      const offers = /* @__PURE__ */ Object.create(null);
      let params = /* @__PURE__ */ Object.create(null);
      let mustUnescape = false;
      let isEscaping = false;
      let inQuotes = false;
      let extensionName;
      let paramName;
      let start = -1;
      let code = -1;
      let end = -1;
      let i = 0;
      for (; i < header.length; i++) {
        code = header.charCodeAt(i);
        if (extensionName === void 0) {
          if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (i !== 0 && (code === 32 || code === 9)) {
            if (end === -1 && start !== -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            const name = header.slice(start, end);
            if (code === 44) {
              push(offers, name, params);
              params = /* @__PURE__ */ Object.create(null);
            } else {
              extensionName = name;
            }
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else if (paramName === void 0) {
          if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (code === 32 || code === 9) {
            if (end === -1 && start !== -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            push(params, header.slice(start, end), true);
            if (code === 44) {
              push(offers, extensionName, params);
              params = /* @__PURE__ */ Object.create(null);
              extensionName = void 0;
            }
            start = end = -1;
          } else if (code === 61 && start !== -1 && end === -1) {
            paramName = header.slice(start, i);
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else {
          if (isEscaping) {
            if (tokenChars[code] !== 1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (start === -1) start = i;
            else if (!mustUnescape) mustUnescape = true;
            isEscaping = false;
          } else if (inQuotes) {
            if (tokenChars[code] === 1) {
              if (start === -1) start = i;
            } else if (code === 34 && start !== -1) {
              inQuotes = false;
              end = i;
            } else if (code === 92) {
              isEscaping = true;
            } else {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
          } else if (code === 34 && header.charCodeAt(i - 1) === 61) {
            inQuotes = true;
          } else if (end === -1 && tokenChars[code] === 1) {
            if (start === -1) start = i;
          } else if (start !== -1 && (code === 32 || code === 9)) {
            if (end === -1) end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1) end = i;
            let value = header.slice(start, end);
            if (mustUnescape) {
              value = value.replace(/\\/g, "");
              mustUnescape = false;
            }
            push(params, paramName, value);
            if (code === 44) {
              push(offers, extensionName, params);
              params = /* @__PURE__ */ Object.create(null);
              extensionName = void 0;
            }
            paramName = void 0;
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        }
      }
      if (start === -1 || inQuotes || code === 32 || code === 9) {
        throw new SyntaxError("Unexpected end of input");
      }
      if (end === -1) end = i;
      const token = header.slice(start, end);
      if (extensionName === void 0) {
        push(offers, token, params);
      } else {
        if (paramName === void 0) {
          push(params, token, true);
        } else if (mustUnescape) {
          push(params, paramName, token.replace(/\\/g, ""));
        } else {
          push(params, paramName, token);
        }
        push(offers, extensionName, params);
      }
      return offers;
    }
    function format(extensions) {
      return Object.keys(extensions).map((extension2) => {
        let configurations = extensions[extension2];
        if (!Array.isArray(configurations)) configurations = [configurations];
        return configurations.map((params) => {
          return [extension2].concat(
            Object.keys(params).map((k) => {
              let values = params[k];
              if (!Array.isArray(values)) values = [values];
              return values.map((v) => v === true ? k : `${k}=${v}`).join("; ");
            })
          ).join("; ");
        }).join(", ");
      }).join(", ");
    }
    module2.exports = { format, parse };
  }
});

// ../../node_modules/ws/lib/websocket.js
var require_websocket = __commonJS({
  "../../node_modules/ws/lib/websocket.js"(exports2, module2) {
    "use strict";
    var EventEmitter = require("events");
    var https = require("https");
    var http = require("http");
    var net2 = require("net");
    var tls = require("tls");
    var { randomBytes, createHash } = require("crypto");
    var { Duplex, Readable } = require("stream");
    var { URL: URL3 } = require("url");
    var PerMessageDeflate2 = require_permessage_deflate();
    var Receiver2 = require_receiver();
    var Sender2 = require_sender();
    var { isBlob } = require_validation();
    var {
      BINARY_TYPES,
      CLOSE_TIMEOUT,
      EMPTY_BUFFER,
      GUID,
      kForOnEventAttribute,
      kListener,
      kStatusCode,
      kWebSocket,
      NOOP
    } = require_constants();
    var {
      EventTarget: { addEventListener, removeEventListener }
    } = require_event_target();
    var { format, parse } = require_extension();
    var { toBuffer } = require_buffer_util();
    var kAborted = /* @__PURE__ */ Symbol("kAborted");
    var protocolVersions = [8, 13];
    var readyStates = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];
    var subprotocolRegex = /^[!#$%&'*+\-.0-9A-Z^_`|a-z~]+$/;
    var WebSocket2 = class _WebSocket extends EventEmitter {
      /**
       * Create a new `WebSocket`.
       *
       * @param {(String|URL)} address The URL to which to connect
       * @param {(String|String[])} [protocols] The subprotocols
       * @param {Object} [options] Connection options
       */
      constructor(address, protocols, options) {
        super();
        this._binaryType = BINARY_TYPES[0];
        this._closeCode = 1006;
        this._closeFrameReceived = false;
        this._closeFrameSent = false;
        this._closeMessage = EMPTY_BUFFER;
        this._closeTimer = null;
        this._errorEmitted = false;
        this._extensions = {};
        this._paused = false;
        this._protocol = "";
        this._readyState = _WebSocket.CONNECTING;
        this._receiver = null;
        this._sender = null;
        this._socket = null;
        if (address !== null) {
          this._bufferedAmount = 0;
          this._isServer = false;
          this._redirects = 0;
          if (protocols === void 0) {
            protocols = [];
          } else if (!Array.isArray(protocols)) {
            if (typeof protocols === "object" && protocols !== null) {
              options = protocols;
              protocols = [];
            } else {
              protocols = [protocols];
            }
          }
          initAsClient(this, address, protocols, options);
        } else {
          this._autoPong = options.autoPong;
          this._closeTimeout = options.closeTimeout;
          this._isServer = true;
        }
      }
      /**
       * For historical reasons, the custom "nodebuffer" type is used by the default
       * instead of "blob".
       *
       * @type {String}
       */
      get binaryType() {
        return this._binaryType;
      }
      set binaryType(type) {
        if (!BINARY_TYPES.includes(type)) return;
        this._binaryType = type;
        if (this._receiver) this._receiver._binaryType = type;
      }
      /**
       * @type {Number}
       */
      get bufferedAmount() {
        if (!this._socket) return this._bufferedAmount;
        return this._socket._writableState.length + this._sender._bufferedBytes;
      }
      /**
       * @type {String}
       */
      get extensions() {
        return Object.keys(this._extensions).join();
      }
      /**
       * @type {Boolean}
       */
      get isPaused() {
        return this._paused;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onclose() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onerror() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onopen() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onmessage() {
        return null;
      }
      /**
       * @type {String}
       */
      get protocol() {
        return this._protocol;
      }
      /**
       * @type {Number}
       */
      get readyState() {
        return this._readyState;
      }
      /**
       * @type {String}
       */
      get url() {
        return this._url;
      }
      /**
       * Set up the socket and the internal resources.
       *
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Object} options Options object
       * @param {Boolean} [options.allowSynchronousEvents=false] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Number} [options.maxPayload=0] The maximum allowed message size
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       * @private
       */
      setSocket(socket, head, options) {
        const receiver = new Receiver2({
          allowSynchronousEvents: options.allowSynchronousEvents,
          binaryType: this.binaryType,
          extensions: this._extensions,
          isServer: this._isServer,
          maxPayload: options.maxPayload,
          skipUTF8Validation: options.skipUTF8Validation
        });
        const sender = new Sender2(socket, this._extensions, options.generateMask);
        this._receiver = receiver;
        this._sender = sender;
        this._socket = socket;
        receiver[kWebSocket] = this;
        sender[kWebSocket] = this;
        socket[kWebSocket] = this;
        receiver.on("conclude", receiverOnConclude);
        receiver.on("drain", receiverOnDrain);
        receiver.on("error", receiverOnError);
        receiver.on("message", receiverOnMessage);
        receiver.on("ping", receiverOnPing);
        receiver.on("pong", receiverOnPong);
        sender.onerror = senderOnError;
        if (socket.setTimeout) socket.setTimeout(0);
        if (socket.setNoDelay) socket.setNoDelay();
        if (head.length > 0) socket.unshift(head);
        socket.on("close", socketOnClose);
        socket.on("data", socketOnData);
        socket.on("end", socketOnEnd);
        socket.on("error", socketOnError);
        this._readyState = _WebSocket.OPEN;
        this.emit("open");
      }
      /**
       * Emit the `'close'` event.
       *
       * @private
       */
      emitClose() {
        if (!this._socket) {
          this._readyState = _WebSocket.CLOSED;
          this.emit("close", this._closeCode, this._closeMessage);
          return;
        }
        if (this._extensions[PerMessageDeflate2.extensionName]) {
          this._extensions[PerMessageDeflate2.extensionName].cleanup();
        }
        this._receiver.removeAllListeners();
        this._readyState = _WebSocket.CLOSED;
        this.emit("close", this._closeCode, this._closeMessage);
      }
      /**
       * Start a closing handshake.
       *
       *          +----------+   +-----------+   +----------+
       *     - - -|ws.close()|-->|close frame|-->|ws.close()|- - -
       *    |     +----------+   +-----------+   +----------+     |
       *          +----------+   +-----------+         |
       * CLOSING  |ws.close()|<--|close frame|<--+-----+       CLOSING
       *          +----------+   +-----------+   |
       *    |           |                        |   +---+        |
       *                +------------------------+-->|fin| - - - -
       *    |         +---+                      |   +---+
       *     - - - - -|fin|<---------------------+
       *              +---+
       *
       * @param {Number} [code] Status code explaining why the connection is closing
       * @param {(String|Buffer)} [data] The reason why the connection is
       *     closing
       * @public
       */
      close(code, data) {
        if (this.readyState === _WebSocket.CLOSED) return;
        if (this.readyState === _WebSocket.CONNECTING) {
          const msg = "WebSocket was closed before the connection was established";
          abortHandshake(this, this._req, msg);
          return;
        }
        if (this.readyState === _WebSocket.CLOSING) {
          if (this._closeFrameSent && (this._closeFrameReceived || this._receiver._writableState.errorEmitted)) {
            this._socket.end();
          }
          return;
        }
        this._readyState = _WebSocket.CLOSING;
        this._sender.close(code, data, !this._isServer, (err) => {
          if (err) return;
          this._closeFrameSent = true;
          if (this._closeFrameReceived || this._receiver._writableState.errorEmitted) {
            this._socket.end();
          }
        });
        setCloseTimer(this);
      }
      /**
       * Pause the socket.
       *
       * @public
       */
      pause() {
        if (this.readyState === _WebSocket.CONNECTING || this.readyState === _WebSocket.CLOSED) {
          return;
        }
        this._paused = true;
        this._socket.pause();
      }
      /**
       * Send a ping.
       *
       * @param {*} [data] The data to send
       * @param {Boolean} [mask] Indicates whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when the ping is sent
       * @public
       */
      ping(data, mask, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof data === "function") {
          cb = data;
          data = mask = void 0;
        } else if (typeof mask === "function") {
          cb = mask;
          mask = void 0;
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        if (mask === void 0) mask = !this._isServer;
        this._sender.ping(data || EMPTY_BUFFER, mask, cb);
      }
      /**
       * Send a pong.
       *
       * @param {*} [data] The data to send
       * @param {Boolean} [mask] Indicates whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when the pong is sent
       * @public
       */
      pong(data, mask, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof data === "function") {
          cb = data;
          data = mask = void 0;
        } else if (typeof mask === "function") {
          cb = mask;
          mask = void 0;
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        if (mask === void 0) mask = !this._isServer;
        this._sender.pong(data || EMPTY_BUFFER, mask, cb);
      }
      /**
       * Resume the socket.
       *
       * @public
       */
      resume() {
        if (this.readyState === _WebSocket.CONNECTING || this.readyState === _WebSocket.CLOSED) {
          return;
        }
        this._paused = false;
        if (!this._receiver._writableState.needDrain) this._socket.resume();
      }
      /**
       * Send a data message.
       *
       * @param {*} data The message to send
       * @param {Object} [options] Options object
       * @param {Boolean} [options.binary] Specifies whether `data` is binary or
       *     text
       * @param {Boolean} [options.compress] Specifies whether or not to compress
       *     `data`
       * @param {Boolean} [options.fin=true] Specifies whether the fragment is the
       *     last one
       * @param {Boolean} [options.mask] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when data is written out
       * @public
       */
      send(data, options, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof options === "function") {
          cb = options;
          options = {};
        }
        if (typeof data === "number") data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        const opts = {
          binary: typeof data !== "string",
          mask: !this._isServer,
          compress: true,
          fin: true,
          ...options
        };
        if (!this._extensions[PerMessageDeflate2.extensionName]) {
          opts.compress = false;
        }
        this._sender.send(data || EMPTY_BUFFER, opts, cb);
      }
      /**
       * Forcibly close the connection.
       *
       * @public
       */
      terminate() {
        if (this.readyState === _WebSocket.CLOSED) return;
        if (this.readyState === _WebSocket.CONNECTING) {
          const msg = "WebSocket was closed before the connection was established";
          abortHandshake(this, this._req, msg);
          return;
        }
        if (this._socket) {
          this._readyState = _WebSocket.CLOSING;
          this._socket.destroy();
        }
      }
    };
    Object.defineProperty(WebSocket2, "CONNECTING", {
      enumerable: true,
      value: readyStates.indexOf("CONNECTING")
    });
    Object.defineProperty(WebSocket2.prototype, "CONNECTING", {
      enumerable: true,
      value: readyStates.indexOf("CONNECTING")
    });
    Object.defineProperty(WebSocket2, "OPEN", {
      enumerable: true,
      value: readyStates.indexOf("OPEN")
    });
    Object.defineProperty(WebSocket2.prototype, "OPEN", {
      enumerable: true,
      value: readyStates.indexOf("OPEN")
    });
    Object.defineProperty(WebSocket2, "CLOSING", {
      enumerable: true,
      value: readyStates.indexOf("CLOSING")
    });
    Object.defineProperty(WebSocket2.prototype, "CLOSING", {
      enumerable: true,
      value: readyStates.indexOf("CLOSING")
    });
    Object.defineProperty(WebSocket2, "CLOSED", {
      enumerable: true,
      value: readyStates.indexOf("CLOSED")
    });
    Object.defineProperty(WebSocket2.prototype, "CLOSED", {
      enumerable: true,
      value: readyStates.indexOf("CLOSED")
    });
    [
      "binaryType",
      "bufferedAmount",
      "extensions",
      "isPaused",
      "protocol",
      "readyState",
      "url"
    ].forEach((property) => {
      Object.defineProperty(WebSocket2.prototype, property, { enumerable: true });
    });
    ["open", "error", "close", "message"].forEach((method) => {
      Object.defineProperty(WebSocket2.prototype, `on${method}`, {
        enumerable: true,
        get() {
          for (const listener of this.listeners(method)) {
            if (listener[kForOnEventAttribute]) return listener[kListener];
          }
          return null;
        },
        set(handler) {
          for (const listener of this.listeners(method)) {
            if (listener[kForOnEventAttribute]) {
              this.removeListener(method, listener);
              break;
            }
          }
          if (typeof handler !== "function") return;
          this.addEventListener(method, handler, {
            [kForOnEventAttribute]: true
          });
        }
      });
    });
    WebSocket2.prototype.addEventListener = addEventListener;
    WebSocket2.prototype.removeEventListener = removeEventListener;
    module2.exports = WebSocket2;
    function initAsClient(websocket, address, protocols, options) {
      const opts = {
        allowSynchronousEvents: true,
        autoPong: true,
        closeTimeout: CLOSE_TIMEOUT,
        protocolVersion: protocolVersions[1],
        maxPayload: 100 * 1024 * 1024,
        skipUTF8Validation: false,
        perMessageDeflate: true,
        followRedirects: false,
        maxRedirects: 10,
        ...options,
        socketPath: void 0,
        hostname: void 0,
        protocol: void 0,
        timeout: void 0,
        method: "GET",
        host: void 0,
        path: void 0,
        port: void 0
      };
      websocket._autoPong = opts.autoPong;
      websocket._closeTimeout = opts.closeTimeout;
      if (!protocolVersions.includes(opts.protocolVersion)) {
        throw new RangeError(
          `Unsupported protocol version: ${opts.protocolVersion} (supported versions: ${protocolVersions.join(", ")})`
        );
      }
      let parsedUrl;
      if (address instanceof URL3) {
        parsedUrl = address;
      } else {
        try {
          parsedUrl = new URL3(address);
        } catch {
          throw new SyntaxError(`Invalid URL: ${address}`);
        }
      }
      if (parsedUrl.protocol === "http:") {
        parsedUrl.protocol = "ws:";
      } else if (parsedUrl.protocol === "https:") {
        parsedUrl.protocol = "wss:";
      }
      websocket._url = parsedUrl.href;
      const isSecure = parsedUrl.protocol === "wss:";
      const isIpcUrl = parsedUrl.protocol === "ws+unix:";
      let invalidUrlMessage;
      if (parsedUrl.protocol !== "ws:" && !isSecure && !isIpcUrl) {
        invalidUrlMessage = `The URL's protocol must be one of "ws:", "wss:", "http:", "https:", or "ws+unix:"`;
      } else if (isIpcUrl && !parsedUrl.pathname) {
        invalidUrlMessage = "The URL's pathname is empty";
      } else if (parsedUrl.hash) {
        invalidUrlMessage = "The URL contains a fragment identifier";
      }
      if (invalidUrlMessage) {
        const err = new SyntaxError(invalidUrlMessage);
        if (websocket._redirects === 0) {
          throw err;
        } else {
          emitErrorAndClose(websocket, err);
          return;
        }
      }
      const defaultPort = isSecure ? 443 : 80;
      const key = randomBytes(16).toString("base64");
      const request = isSecure ? https.request : http.request;
      const protocolSet = /* @__PURE__ */ new Set();
      let perMessageDeflate;
      opts.createConnection = opts.createConnection || (isSecure ? tlsConnect : netConnect);
      opts.defaultPort = opts.defaultPort || defaultPort;
      opts.port = parsedUrl.port || defaultPort;
      opts.host = parsedUrl.hostname.startsWith("[") ? parsedUrl.hostname.slice(1, -1) : parsedUrl.hostname;
      opts.headers = {
        ...opts.headers,
        "Sec-WebSocket-Version": opts.protocolVersion,
        "Sec-WebSocket-Key": key,
        Connection: "Upgrade",
        Upgrade: "websocket"
      };
      opts.path = parsedUrl.pathname + parsedUrl.search;
      opts.timeout = opts.handshakeTimeout;
      if (opts.perMessageDeflate) {
        perMessageDeflate = new PerMessageDeflate2({
          ...opts.perMessageDeflate,
          isServer: false,
          maxPayload: opts.maxPayload
        });
        opts.headers["Sec-WebSocket-Extensions"] = format({
          [PerMessageDeflate2.extensionName]: perMessageDeflate.offer()
        });
      }
      if (protocols.length) {
        for (const protocol of protocols) {
          if (typeof protocol !== "string" || !subprotocolRegex.test(protocol) || protocolSet.has(protocol)) {
            throw new SyntaxError(
              "An invalid or duplicated subprotocol was specified"
            );
          }
          protocolSet.add(protocol);
        }
        opts.headers["Sec-WebSocket-Protocol"] = protocols.join(",");
      }
      if (opts.origin) {
        if (opts.protocolVersion < 13) {
          opts.headers["Sec-WebSocket-Origin"] = opts.origin;
        } else {
          opts.headers.Origin = opts.origin;
        }
      }
      if (parsedUrl.username || parsedUrl.password) {
        opts.auth = `${parsedUrl.username}:${parsedUrl.password}`;
      }
      if (isIpcUrl) {
        const parts = opts.path.split(":");
        opts.socketPath = parts[0];
        opts.path = parts[1];
      }
      let req;
      if (opts.followRedirects) {
        if (websocket._redirects === 0) {
          websocket._originalIpc = isIpcUrl;
          websocket._originalSecure = isSecure;
          websocket._originalHostOrSocketPath = isIpcUrl ? opts.socketPath : parsedUrl.host;
          const headers = options && options.headers;
          options = { ...options, headers: {} };
          if (headers) {
            for (const [key2, value] of Object.entries(headers)) {
              options.headers[key2.toLowerCase()] = value;
            }
          }
        } else if (websocket.listenerCount("redirect") === 0) {
          const isSameHost = isIpcUrl ? websocket._originalIpc ? opts.socketPath === websocket._originalHostOrSocketPath : false : websocket._originalIpc ? false : parsedUrl.host === websocket._originalHostOrSocketPath;
          if (!isSameHost || websocket._originalSecure && !isSecure) {
            delete opts.headers.authorization;
            delete opts.headers.cookie;
            if (!isSameHost) delete opts.headers.host;
            opts.auth = void 0;
          }
        }
        if (opts.auth && !options.headers.authorization) {
          options.headers.authorization = "Basic " + Buffer.from(opts.auth).toString("base64");
        }
        req = websocket._req = request(opts);
        if (websocket._redirects) {
          websocket.emit("redirect", websocket.url, req);
        }
      } else {
        req = websocket._req = request(opts);
      }
      if (opts.timeout) {
        req.on("timeout", () => {
          abortHandshake(websocket, req, "Opening handshake has timed out");
        });
      }
      req.on("error", (err) => {
        if (req === null || req[kAborted]) return;
        req = websocket._req = null;
        emitErrorAndClose(websocket, err);
      });
      req.on("response", (res) => {
        const location = res.headers.location;
        const statusCode = res.statusCode;
        if (location && opts.followRedirects && statusCode >= 300 && statusCode < 400) {
          if (++websocket._redirects > opts.maxRedirects) {
            abortHandshake(websocket, req, "Maximum redirects exceeded");
            return;
          }
          req.abort();
          let addr;
          try {
            addr = new URL3(location, address);
          } catch (e) {
            const err = new SyntaxError(`Invalid URL: ${location}`);
            emitErrorAndClose(websocket, err);
            return;
          }
          initAsClient(websocket, addr, protocols, options);
        } else if (!websocket.emit("unexpected-response", req, res)) {
          abortHandshake(
            websocket,
            req,
            `Unexpected server response: ${res.statusCode}`
          );
        }
      });
      req.on("upgrade", (res, socket, head) => {
        websocket.emit("upgrade", res);
        if (websocket.readyState !== WebSocket2.CONNECTING) return;
        req = websocket._req = null;
        const upgrade = res.headers.upgrade;
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          abortHandshake(websocket, socket, "Invalid Upgrade header");
          return;
        }
        const digest = createHash("sha1").update(key + GUID).digest("base64");
        if (res.headers["sec-websocket-accept"] !== digest) {
          abortHandshake(websocket, socket, "Invalid Sec-WebSocket-Accept header");
          return;
        }
        const serverProt = res.headers["sec-websocket-protocol"];
        let protError;
        if (serverProt !== void 0) {
          if (!protocolSet.size) {
            protError = "Server sent a subprotocol but none was requested";
          } else if (!protocolSet.has(serverProt)) {
            protError = "Server sent an invalid subprotocol";
          }
        } else if (protocolSet.size) {
          protError = "Server sent no subprotocol";
        }
        if (protError) {
          abortHandshake(websocket, socket, protError);
          return;
        }
        if (serverProt) websocket._protocol = serverProt;
        const secWebSocketExtensions = res.headers["sec-websocket-extensions"];
        if (secWebSocketExtensions !== void 0) {
          if (!perMessageDeflate) {
            const message = "Server sent a Sec-WebSocket-Extensions header but no extension was requested";
            abortHandshake(websocket, socket, message);
            return;
          }
          let extensions;
          try {
            extensions = parse(secWebSocketExtensions);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket, message);
            return;
          }
          const extensionNames = Object.keys(extensions);
          if (extensionNames.length !== 1 || extensionNames[0] !== PerMessageDeflate2.extensionName) {
            const message = "Server indicated an extension that was not requested";
            abortHandshake(websocket, socket, message);
            return;
          }
          try {
            perMessageDeflate.accept(extensions[PerMessageDeflate2.extensionName]);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket, message);
            return;
          }
          websocket._extensions[PerMessageDeflate2.extensionName] = perMessageDeflate;
        }
        websocket.setSocket(socket, head, {
          allowSynchronousEvents: opts.allowSynchronousEvents,
          generateMask: opts.generateMask,
          maxPayload: opts.maxPayload,
          skipUTF8Validation: opts.skipUTF8Validation
        });
      });
      if (opts.finishRequest) {
        opts.finishRequest(req, websocket);
      } else {
        req.end();
      }
    }
    function emitErrorAndClose(websocket, err) {
      websocket._readyState = WebSocket2.CLOSING;
      websocket._errorEmitted = true;
      websocket.emit("error", err);
      websocket.emitClose();
    }
    function netConnect(options) {
      options.path = options.socketPath;
      return net2.connect(options);
    }
    function tlsConnect(options) {
      options.path = void 0;
      if (!options.servername && options.servername !== "") {
        options.servername = net2.isIP(options.host) ? "" : options.host;
      }
      return tls.connect(options);
    }
    function abortHandshake(websocket, stream, message) {
      websocket._readyState = WebSocket2.CLOSING;
      const err = new Error(message);
      Error.captureStackTrace(err, abortHandshake);
      if (stream.setHeader) {
        stream[kAborted] = true;
        stream.abort();
        if (stream.socket && !stream.socket.destroyed) {
          stream.socket.destroy();
        }
        process.nextTick(emitErrorAndClose, websocket, err);
      } else {
        stream.destroy(err);
        stream.once("error", websocket.emit.bind(websocket, "error"));
        stream.once("close", websocket.emitClose.bind(websocket));
      }
    }
    function sendAfterClose(websocket, data, cb) {
      if (data) {
        const length = isBlob(data) ? data.size : toBuffer(data).length;
        if (websocket._socket) websocket._sender._bufferedBytes += length;
        else websocket._bufferedAmount += length;
      }
      if (cb) {
        const err = new Error(
          `WebSocket is not open: readyState ${websocket.readyState} (${readyStates[websocket.readyState]})`
        );
        process.nextTick(cb, err);
      }
    }
    function receiverOnConclude(code, reason) {
      const websocket = this[kWebSocket];
      websocket._closeFrameReceived = true;
      websocket._closeMessage = reason;
      websocket._closeCode = code;
      if (websocket._socket[kWebSocket] === void 0) return;
      websocket._socket.removeListener("data", socketOnData);
      process.nextTick(resume, websocket._socket);
      if (code === 1005) websocket.close();
      else websocket.close(code, reason);
    }
    function receiverOnDrain() {
      const websocket = this[kWebSocket];
      if (!websocket.isPaused) websocket._socket.resume();
    }
    function receiverOnError(err) {
      const websocket = this[kWebSocket];
      if (websocket._socket[kWebSocket] !== void 0) {
        websocket._socket.removeListener("data", socketOnData);
        process.nextTick(resume, websocket._socket);
        websocket.close(err[kStatusCode]);
      }
      if (!websocket._errorEmitted) {
        websocket._errorEmitted = true;
        websocket.emit("error", err);
      }
    }
    function receiverOnFinish() {
      this[kWebSocket].emitClose();
    }
    function receiverOnMessage(data, isBinary) {
      this[kWebSocket].emit("message", data, isBinary);
    }
    function receiverOnPing(data) {
      const websocket = this[kWebSocket];
      if (websocket._autoPong) websocket.pong(data, !this._isServer, NOOP);
      websocket.emit("ping", data);
    }
    function receiverOnPong(data) {
      this[kWebSocket].emit("pong", data);
    }
    function resume(stream) {
      stream.resume();
    }
    function senderOnError(err) {
      const websocket = this[kWebSocket];
      if (websocket.readyState === WebSocket2.CLOSED) return;
      if (websocket.readyState === WebSocket2.OPEN) {
        websocket._readyState = WebSocket2.CLOSING;
        setCloseTimer(websocket);
      }
      this._socket.end();
      if (!websocket._errorEmitted) {
        websocket._errorEmitted = true;
        websocket.emit("error", err);
      }
    }
    function setCloseTimer(websocket) {
      websocket._closeTimer = setTimeout(
        websocket._socket.destroy.bind(websocket._socket),
        websocket._closeTimeout
      );
    }
    function socketOnClose() {
      const websocket = this[kWebSocket];
      this.removeListener("close", socketOnClose);
      this.removeListener("data", socketOnData);
      this.removeListener("end", socketOnEnd);
      websocket._readyState = WebSocket2.CLOSING;
      if (!this._readableState.endEmitted && !websocket._closeFrameReceived && !websocket._receiver._writableState.errorEmitted && this._readableState.length !== 0) {
        const chunk = this.read(this._readableState.length);
        websocket._receiver.write(chunk);
      }
      websocket._receiver.end();
      this[kWebSocket] = void 0;
      clearTimeout(websocket._closeTimer);
      if (websocket._receiver._writableState.finished || websocket._receiver._writableState.errorEmitted) {
        websocket.emitClose();
      } else {
        websocket._receiver.on("error", receiverOnFinish);
        websocket._receiver.on("finish", receiverOnFinish);
      }
    }
    function socketOnData(chunk) {
      if (!this[kWebSocket]._receiver.write(chunk)) {
        this.pause();
      }
    }
    function socketOnEnd() {
      const websocket = this[kWebSocket];
      websocket._readyState = WebSocket2.CLOSING;
      websocket._receiver.end();
      this.end();
    }
    function socketOnError() {
      const websocket = this[kWebSocket];
      this.removeListener("error", socketOnError);
      this.on("error", NOOP);
      if (websocket) {
        websocket._readyState = WebSocket2.CLOSING;
        this.destroy();
      }
    }
  }
});

// ../../node_modules/ws/lib/stream.js
var require_stream = __commonJS({
  "../../node_modules/ws/lib/stream.js"(exports2, module2) {
    "use strict";
    var WebSocket2 = require_websocket();
    var { Duplex } = require("stream");
    function emitClose(stream) {
      stream.emit("close");
    }
    function duplexOnEnd() {
      if (!this.destroyed && this._writableState.finished) {
        this.destroy();
      }
    }
    function duplexOnError(err) {
      this.removeListener("error", duplexOnError);
      this.destroy();
      if (this.listenerCount("error") === 0) {
        this.emit("error", err);
      }
    }
    function createWebSocketStream2(ws, options) {
      let terminateOnDestroy = true;
      const duplex = new Duplex({
        ...options,
        autoDestroy: false,
        emitClose: false,
        objectMode: false,
        writableObjectMode: false
      });
      ws.on("message", function message(msg, isBinary) {
        const data = !isBinary && duplex._readableState.objectMode ? msg.toString() : msg;
        if (!duplex.push(data)) ws.pause();
      });
      ws.once("error", function error(err) {
        if (duplex.destroyed) return;
        terminateOnDestroy = false;
        duplex.destroy(err);
      });
      ws.once("close", function close() {
        if (duplex.destroyed) return;
        duplex.push(null);
      });
      duplex._destroy = function(err, callback) {
        if (ws.readyState === ws.CLOSED) {
          callback(err);
          process.nextTick(emitClose, duplex);
          return;
        }
        let called = false;
        ws.once("error", function error(err2) {
          called = true;
          callback(err2);
        });
        ws.once("close", function close() {
          if (!called) callback(err);
          process.nextTick(emitClose, duplex);
        });
        if (terminateOnDestroy) ws.terminate();
      };
      duplex._final = function(callback) {
        if (ws.readyState === ws.CONNECTING) {
          ws.once("open", function open() {
            duplex._final(callback);
          });
          return;
        }
        if (ws._socket === null) return;
        if (ws._socket._writableState.finished) {
          callback();
          if (duplex._readableState.endEmitted) duplex.destroy();
        } else {
          ws._socket.once("finish", function finish() {
            callback();
          });
          ws.close();
        }
      };
      duplex._read = function() {
        if (ws.isPaused) ws.resume();
      };
      duplex._write = function(chunk, encoding, callback) {
        if (ws.readyState === ws.CONNECTING) {
          ws.once("open", function open() {
            duplex._write(chunk, encoding, callback);
          });
          return;
        }
        ws.send(chunk, callback);
      };
      duplex.on("end", duplexOnEnd);
      duplex.on("error", duplexOnError);
      return duplex;
    }
    module2.exports = createWebSocketStream2;
  }
});

// ../../node_modules/ws/lib/subprotocol.js
var require_subprotocol = __commonJS({
  "../../node_modules/ws/lib/subprotocol.js"(exports2, module2) {
    "use strict";
    var { tokenChars } = require_validation();
    function parse(header) {
      const protocols = /* @__PURE__ */ new Set();
      let start = -1;
      let end = -1;
      let i = 0;
      for (i; i < header.length; i++) {
        const code = header.charCodeAt(i);
        if (end === -1 && tokenChars[code] === 1) {
          if (start === -1) start = i;
        } else if (i !== 0 && (code === 32 || code === 9)) {
          if (end === -1 && start !== -1) end = i;
        } else if (code === 44) {
          if (start === -1) {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
          if (end === -1) end = i;
          const protocol2 = header.slice(start, end);
          if (protocols.has(protocol2)) {
            throw new SyntaxError(`The "${protocol2}" subprotocol is duplicated`);
          }
          protocols.add(protocol2);
          start = end = -1;
        } else {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
      }
      if (start === -1 || end !== -1) {
        throw new SyntaxError("Unexpected end of input");
      }
      const protocol = header.slice(start, i);
      if (protocols.has(protocol)) {
        throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
      }
      protocols.add(protocol);
      return protocols;
    }
    module2.exports = { parse };
  }
});

// ../../node_modules/ws/lib/websocket-server.js
var require_websocket_server = __commonJS({
  "../../node_modules/ws/lib/websocket-server.js"(exports2, module2) {
    "use strict";
    var EventEmitter = require("events");
    var http = require("http");
    var { Duplex } = require("stream");
    var { createHash } = require("crypto");
    var extension2 = require_extension();
    var PerMessageDeflate2 = require_permessage_deflate();
    var subprotocol2 = require_subprotocol();
    var WebSocket2 = require_websocket();
    var { CLOSE_TIMEOUT, GUID, kWebSocket } = require_constants();
    var keyRegex = /^[+/0-9A-Za-z]{22}==$/;
    var RUNNING = 0;
    var CLOSING = 1;
    var CLOSED = 2;
    var WebSocketServer2 = class extends EventEmitter {
      /**
       * Create a `WebSocketServer` instance.
       *
       * @param {Object} options Configuration options
       * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {Boolean} [options.autoPong=true] Specifies whether or not to
       *     automatically send a pong in response to a ping
       * @param {Number} [options.backlog=511] The maximum length of the queue of
       *     pending connections
       * @param {Boolean} [options.clientTracking=true] Specifies whether or not to
       *     track clients
       * @param {Number} [options.closeTimeout=30000] Duration in milliseconds to
       *     wait for the closing handshake to finish after `websocket.close()` is
       *     called
       * @param {Function} [options.handleProtocols] A hook to handle protocols
       * @param {String} [options.host] The hostname where to bind the server
       * @param {Number} [options.maxPayload=104857600] The maximum allowed message
       *     size
       * @param {Boolean} [options.noServer=false] Enable no server mode
       * @param {String} [options.path] Accept only connections matching this path
       * @param {(Boolean|Object)} [options.perMessageDeflate=false] Enable/disable
       *     permessage-deflate
       * @param {Number} [options.port] The port where to bind the server
       * @param {(http.Server|https.Server)} [options.server] A pre-created HTTP/S
       *     server to use
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       * @param {Function} [options.verifyClient] A hook to reject connections
       * @param {Function} [options.WebSocket=WebSocket] Specifies the `WebSocket`
       *     class to use. It must be the `WebSocket` class or class that extends it
       * @param {Function} [callback] A listener for the `listening` event
       */
      constructor(options, callback) {
        super();
        options = {
          allowSynchronousEvents: true,
          autoPong: true,
          maxPayload: 100 * 1024 * 1024,
          skipUTF8Validation: false,
          perMessageDeflate: false,
          handleProtocols: null,
          clientTracking: true,
          closeTimeout: CLOSE_TIMEOUT,
          verifyClient: null,
          noServer: false,
          backlog: null,
          // use default (511 as implemented in net.js)
          server: null,
          host: null,
          path: null,
          port: null,
          WebSocket: WebSocket2,
          ...options
        };
        if (options.port == null && !options.server && !options.noServer || options.port != null && (options.server || options.noServer) || options.server && options.noServer) {
          throw new TypeError(
            'One and only one of the "port", "server", or "noServer" options must be specified'
          );
        }
        if (options.port != null) {
          this._server = http.createServer((req, res) => {
            const body = http.STATUS_CODES[426];
            res.writeHead(426, {
              "Content-Length": body.length,
              "Content-Type": "text/plain"
            });
            res.end(body);
          });
          this._server.listen(
            options.port,
            options.host,
            options.backlog,
            callback
          );
        } else if (options.server) {
          this._server = options.server;
        }
        if (this._server) {
          const emitConnection = this.emit.bind(this, "connection");
          this._removeListeners = addListeners(this._server, {
            listening: this.emit.bind(this, "listening"),
            error: this.emit.bind(this, "error"),
            upgrade: (req, socket, head) => {
              this.handleUpgrade(req, socket, head, emitConnection);
            }
          });
        }
        if (options.perMessageDeflate === true) options.perMessageDeflate = {};
        if (options.clientTracking) {
          this.clients = /* @__PURE__ */ new Set();
          this._shouldEmitClose = false;
        }
        this.options = options;
        this._state = RUNNING;
      }
      /**
       * Returns the bound address, the address family name, and port of the server
       * as reported by the operating system if listening on an IP socket.
       * If the server is listening on a pipe or UNIX domain socket, the name is
       * returned as a string.
       *
       * @return {(Object|String|null)} The address of the server
       * @public
       */
      address() {
        if (this.options.noServer) {
          throw new Error('The server is operating in "noServer" mode');
        }
        if (!this._server) return null;
        return this._server.address();
      }
      /**
       * Stop the server from accepting new connections and emit the `'close'` event
       * when all existing connections are closed.
       *
       * @param {Function} [cb] A one-time listener for the `'close'` event
       * @public
       */
      close(cb) {
        if (this._state === CLOSED) {
          if (cb) {
            this.once("close", () => {
              cb(new Error("The server is not running"));
            });
          }
          process.nextTick(emitClose, this);
          return;
        }
        if (cb) this.once("close", cb);
        if (this._state === CLOSING) return;
        this._state = CLOSING;
        if (this.options.noServer || this.options.server) {
          if (this._server) {
            this._removeListeners();
            this._removeListeners = this._server = null;
          }
          if (this.clients) {
            if (!this.clients.size) {
              process.nextTick(emitClose, this);
            } else {
              this._shouldEmitClose = true;
            }
          } else {
            process.nextTick(emitClose, this);
          }
        } else {
          const server = this._server;
          this._removeListeners();
          this._removeListeners = this._server = null;
          server.close(() => {
            emitClose(this);
          });
        }
      }
      /**
       * See if a given request should be handled by this server instance.
       *
       * @param {http.IncomingMessage} req Request object to inspect
       * @return {Boolean} `true` if the request is valid, else `false`
       * @public
       */
      shouldHandle(req) {
        if (this.options.path) {
          const index = req.url.indexOf("?");
          const pathname = index !== -1 ? req.url.slice(0, index) : req.url;
          if (pathname !== this.options.path) return false;
        }
        return true;
      }
      /**
       * Handle a HTTP Upgrade request.
       *
       * @param {http.IncomingMessage} req The request object
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Function} cb Callback
       * @public
       */
      handleUpgrade(req, socket, head, cb) {
        socket.on("error", socketOnError);
        const key = req.headers["sec-websocket-key"];
        const upgrade = req.headers.upgrade;
        const version = +req.headers["sec-websocket-version"];
        if (req.method !== "GET") {
          const message = "Invalid HTTP method";
          abortHandshakeOrEmitwsClientError(this, req, socket, 405, message);
          return;
        }
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          const message = "Invalid Upgrade header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
        if (key === void 0 || !keyRegex.test(key)) {
          const message = "Missing or invalid Sec-WebSocket-Key header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
        if (version !== 13 && version !== 8) {
          const message = "Missing or invalid Sec-WebSocket-Version header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message, {
            "Sec-WebSocket-Version": "13, 8"
          });
          return;
        }
        if (!this.shouldHandle(req)) {
          abortHandshake(socket, 400);
          return;
        }
        const secWebSocketProtocol = req.headers["sec-websocket-protocol"];
        let protocols = /* @__PURE__ */ new Set();
        if (secWebSocketProtocol !== void 0) {
          try {
            protocols = subprotocol2.parse(secWebSocketProtocol);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Protocol header";
            abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
            return;
          }
        }
        const secWebSocketExtensions = req.headers["sec-websocket-extensions"];
        const extensions = {};
        if (this.options.perMessageDeflate && secWebSocketExtensions !== void 0) {
          const perMessageDeflate = new PerMessageDeflate2({
            ...this.options.perMessageDeflate,
            isServer: true,
            maxPayload: this.options.maxPayload
          });
          try {
            const offers = extension2.parse(secWebSocketExtensions);
            if (offers[PerMessageDeflate2.extensionName]) {
              perMessageDeflate.accept(offers[PerMessageDeflate2.extensionName]);
              extensions[PerMessageDeflate2.extensionName] = perMessageDeflate;
            }
          } catch (err) {
            const message = "Invalid or unacceptable Sec-WebSocket-Extensions header";
            abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
            return;
          }
        }
        if (this.options.verifyClient) {
          const info = {
            origin: req.headers[`${version === 8 ? "sec-websocket-origin" : "origin"}`],
            secure: !!(req.socket.authorized || req.socket.encrypted),
            req
          };
          if (this.options.verifyClient.length === 2) {
            this.options.verifyClient(info, (verified, code, message, headers) => {
              if (!verified) {
                return abortHandshake(socket, code || 401, message, headers);
              }
              this.completeUpgrade(
                extensions,
                key,
                protocols,
                req,
                socket,
                head,
                cb
              );
            });
            return;
          }
          if (!this.options.verifyClient(info)) return abortHandshake(socket, 401);
        }
        this.completeUpgrade(extensions, key, protocols, req, socket, head, cb);
      }
      /**
       * Upgrade the connection to WebSocket.
       *
       * @param {Object} extensions The accepted extensions
       * @param {String} key The value of the `Sec-WebSocket-Key` header
       * @param {Set} protocols The subprotocols
       * @param {http.IncomingMessage} req The request object
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Function} cb Callback
       * @throws {Error} If called more than once with the same socket
       * @private
       */
      completeUpgrade(extensions, key, protocols, req, socket, head, cb) {
        if (!socket.readable || !socket.writable) return socket.destroy();
        if (socket[kWebSocket]) {
          throw new Error(
            "server.handleUpgrade() was called more than once with the same socket, possibly due to a misconfiguration"
          );
        }
        if (this._state > RUNNING) return abortHandshake(socket, 503);
        const digest = createHash("sha1").update(key + GUID).digest("base64");
        const headers = [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${digest}`
        ];
        const ws = new this.options.WebSocket(null, void 0, this.options);
        if (protocols.size) {
          const protocol = this.options.handleProtocols ? this.options.handleProtocols(protocols, req) : protocols.values().next().value;
          if (protocol) {
            headers.push(`Sec-WebSocket-Protocol: ${protocol}`);
            ws._protocol = protocol;
          }
        }
        if (extensions[PerMessageDeflate2.extensionName]) {
          const params = extensions[PerMessageDeflate2.extensionName].params;
          const value = extension2.format({
            [PerMessageDeflate2.extensionName]: [params]
          });
          headers.push(`Sec-WebSocket-Extensions: ${value}`);
          ws._extensions = extensions;
        }
        this.emit("headers", headers, req);
        socket.write(headers.concat("\r\n").join("\r\n"));
        socket.removeListener("error", socketOnError);
        ws.setSocket(socket, head, {
          allowSynchronousEvents: this.options.allowSynchronousEvents,
          maxPayload: this.options.maxPayload,
          skipUTF8Validation: this.options.skipUTF8Validation
        });
        if (this.clients) {
          this.clients.add(ws);
          ws.on("close", () => {
            this.clients.delete(ws);
            if (this._shouldEmitClose && !this.clients.size) {
              process.nextTick(emitClose, this);
            }
          });
        }
        cb(ws, req);
      }
    };
    module2.exports = WebSocketServer2;
    function addListeners(server, map) {
      for (const event of Object.keys(map)) server.on(event, map[event]);
      return function removeListeners() {
        for (const event of Object.keys(map)) {
          server.removeListener(event, map[event]);
        }
      };
    }
    function emitClose(server) {
      server._state = CLOSED;
      server.emit("close");
    }
    function socketOnError() {
      this.destroy();
    }
    function abortHandshake(socket, code, message, headers) {
      message = message || http.STATUS_CODES[code];
      headers = {
        Connection: "close",
        "Content-Type": "text/html",
        "Content-Length": Buffer.byteLength(message),
        ...headers
      };
      socket.once("finish", socket.destroy);
      socket.end(
        `HTTP/1.1 ${code} ${http.STATUS_CODES[code]}\r
` + Object.keys(headers).map((h) => `${h}: ${headers[h]}`).join("\r\n") + "\r\n\r\n" + message
      );
    }
    function abortHandshakeOrEmitwsClientError(server, req, socket, code, message, headers) {
      if (server.listenerCount("wsClientError")) {
        const err = new Error(message);
        Error.captureStackTrace(err, abortHandshakeOrEmitwsClientError);
        server.emit("wsClientError", err, socket, req);
      } else {
        abortHandshake(socket, code, message, headers);
      }
    }
  }
});

// src/index.ts
var index_exports = {};
__export(index_exports, {
  VERSION: () => VERSION
});
module.exports = __toCommonJS(index_exports);
var import_node_net = __toESM(require("node:net"), 1);

// ../../node_modules/ws/wrapper.mjs
var import_stream = __toESM(require_stream(), 1);
var import_extension = __toESM(require_extension(), 1);
var import_permessage_deflate = __toESM(require_permessage_deflate(), 1);
var import_receiver = __toESM(require_receiver(), 1);
var import_sender = __toESM(require_sender(), 1);
var import_subprotocol = __toESM(require_subprotocol(), 1);
var import_websocket = __toESM(require_websocket(), 1);
var import_websocket_server = __toESM(require_websocket_server(), 1);

// src/service.ts
var import_node_http2 = require("node:http");
var import_node_crypto2 = require("node:crypto");
var import_node_fs5 = require("node:fs");
var import_node_path4 = require("node:path");
var import_node_os2 = require("node:os");

// ../../node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});

// ../../node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// ../../node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// ../../node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// ../../node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}

// ../../node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path, errorMaps, issueData } = params;
  const fullPath = [...path, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;

// ../../node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// ../../node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  constructor(parent, value, path, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {
      } else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
var ZodEnum = class _ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = /* @__PURE__ */ Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: ((arg) => ZodString.create({ ...arg, coerce: true })),
  number: ((arg) => ZodNumber.create({ ...arg, coerce: true })),
  boolean: ((arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  })),
  bigint: ((arg) => ZodBigInt.create({ ...arg, coerce: true })),
  date: ((arg) => ZodDate.create({ ...arg, coerce: true }))
};
var NEVER = INVALID;

// src/tools/get-page-content.ts
var getPageContent = {
  name: "get_page_content",
  description: "Read the text or HTML content of the web page the user is currently viewing in their browser. Use this when the user asks about what is on their screen, current tab, or current page.",
  tier: "free",
  inputSchema: {
    format: external_exports.enum(["text", "html"]).default("text").describe("Output format"),
    tab_id: external_exports.string().describe('Required. Tab ID returned by `list_tabs` (format: "<brand>:<uuid>:<rawId>"). Call `list_tabs` first if you do not have one.')
  }
};

// src/tools/get-page-metadata.ts
var getPageMetadata = {
  name: "get_page_metadata",
  description: "Get metadata (title, URL, description, Open Graph tags, favicon) from the page the user is viewing. Use this when you need a quick summary of what a page is about without reading the full content.",
  tier: "pro",
  inputSchema: {
    tab_id: external_exports.string().describe('Required. Tab ID returned by `list_tabs` (format: "<brand>:<uuid>:<rawId>"). Call `list_tabs` first if you do not have one.')
  }
};

// src/tools/take-screenshot.ts
var takeScreenshot = {
  name: "take_screenshot",
  description: "Take a screenshot of what the user currently sees in their browser. Use this when the user asks you to look at, see, or visually inspect their screen or browser tab.",
  tier: "free",
  inputSchema: {
    format: external_exports.enum(["png", "jpeg"]).default("png").describe("Image format"),
    quality: external_exports.number().min(0).max(100).default(80).describe("JPEG quality (0-100)"),
    tab_id: external_exports.string().describe('Required. Tab ID returned by `list_tabs` (format: "<brand>:<uuid>:<rawId>", e.g. "chrome:abc-123:622786441"). Call `list_tabs` first if you do not have one. The tab will be activated automatically.')
  }
};

// src/tools/list-tabs.ts
var listTabs = {
  name: "list_tabs",
  description: "List all tabs the user has open in their browser with titles and URLs. Use this when the user asks what tabs they have open, or needs help finding or organizing tabs.",
  tier: "free",
  inputSchema: {
    query: external_exports.string().optional().describe("Filter tabs by title or URL match")
  }
};

// src/tools/navigate.ts
var navigate = {
  name: "navigate",
  description: "Navigate the user's browser to a URL. Use this when the user asks you to go to a website, open a page, or navigate somewhere in their browser.",
  tier: "pro",
  inputSchema: {
    url: external_exports.string().describe("Target URL to navigate to"),
    tab_id: external_exports.string().describe('Required. Tab ID returned by `list_tabs` (format: "<brand>:<uuid>:<rawId>"). Call `list_tabs` first if you do not have one.')
  }
};

// src/tools/fill-form.ts
var fillForm = {
  name: "fill_form",
  description: "Fill in form fields on the page the user is viewing. Prefer the `ref` field on each entry \u2014 call `snapshot` first and use the [ref=eN] IDs from the result; refs are unambiguous and work across iframes. Other locators (label, role+name, placeholder, selector) are supported as fallbacks. Element type (text/select/checkbox/radio/file) is auto-detected from the DOM unless you set `type` explicitly. For checkboxes use `checked: true|false`. For multi-select use `values: [...]`. role-only is rejected \u2014 always pair with `name`. Use this when the user asks you to fill out a form, enter data into fields, or auto-complete form inputs in their browser.",
  tier: "pro",
  inputSchema: {
    fields: external_exports.array(external_exports.object({
      ref: external_exports.string().optional().describe('PREFERRED: ref ID from the page snapshot (e.g., "e3"). Unambiguous; works across iframes.'),
      selector: external_exports.string().optional().describe("CSS selector for the form field"),
      label: external_exports.string().optional().describe("Find field by its label text"),
      role: external_exports.string().optional().describe('ARIA role (e.g., "textbox"). Must be paired with `name` \u2014 role-only is rejected.'),
      name: external_exports.string().optional().describe('Accessible name to combine with `role` (e.g., role: "textbox", name: "Email")'),
      placeholder: external_exports.string().optional().describe("Find field by placeholder text"),
      value: external_exports.string().optional().describe("Value to fill in for text inputs, single-select, file paths"),
      values: external_exports.array(external_exports.string()).optional().describe("For multi-select: list of option values. For file inputs: list of file paths."),
      checked: external_exports.boolean().optional().describe('For checkboxes/switches: explicit checked state. Preferred over passing "true"/"false" strings via `value`.'),
      type: external_exports.enum(["text", "select", "checkbox", "radio", "file", "date"]).optional().describe("Override type detection. Usually unnecessary \u2014 type is auto-detected from the DOM.")
    })).describe("Array of form fields to fill. Each field: provide `ref` (preferred) or one of label/role+name/placeholder/selector, plus `value` (or `values`/`checked`)."),
    iframe: external_exports.string().optional().describe("CSS selector for iframe to target. Used only with non-ref locators (refs work across iframes automatically)."),
    tab_id: external_exports.string().describe('Required. Tab ID returned by `list_tabs` (format: "<brand>:<uuid>:<rawId>"). Call `list_tabs` first if you do not have one.')
  }
};

// src/tools/click-element.ts
var clickElement = {
  name: "click_element",
  description: "Click a button, link, or other element on the page the user is viewing. Prefer `ref` from the page snapshot for unambiguous targeting. Falls back to visible text or a CSS selector. Use this when the user asks you to click something, press a button, or interact with an element in their browser.",
  tier: "pro",
  inputSchema: {
    ref: external_exports.string().optional().describe('PREFERRED: ref ID from the page snapshot (e.g., "e7"). Unambiguous and stable.'),
    selector: external_exports.string().optional().describe("CSS selector for the element"),
    text: external_exports.string().optional().describe("Visible text of the button or link to click. Prefers clickable elements (buttons, links) over plain text."),
    index: external_exports.number().optional().default(0).describe("Which match to click when multiple elements match (0 = first). Use when there are duplicate buttons."),
    tab_id: external_exports.string().describe('Required. Tab ID returned by `list_tabs` (format: "<brand>:<uuid>:<rawId>"). Call `list_tabs` first if you do not have one.')
  }
};

// src/tools/press-key.ts
var pressKey = {
  name: "press_key",
  description: 'Press a keyboard key, optionally focused on a specific element. Use this to submit forms (key="Enter" with the last input\'s ref), dismiss dialogs (key="Escape"), navigate (key="Tab", "ArrowDown", "PageDown"), or trigger keyboard shortcuts. Prefer `ref` from the page snapshot to focus a specific element first; omit ref/selector to send the keystroke at the page level.',
  tier: "pro",
  inputSchema: {
    key: external_exports.string().describe('Key name (Playwright syntax): "Enter", "Escape", "Tab", "Backspace", "ArrowDown", "PageDown", "Control+a", etc.'),
    ref: external_exports.string().optional().describe('PREFERRED: ref ID of the element to focus before pressing (from snapshot, e.g., "e3").'),
    selector: external_exports.string().optional().describe("CSS selector of the element to focus before pressing."),
    tab_id: external_exports.string().describe('Required. Tab ID returned by `list_tabs` (format: "<brand>:<uuid>:<rawId>"). Call `list_tabs` first if you do not have one.')
  }
};

// src/tools/extract-table.ts
var extractTable = {
  name: "extract_table",
  description: "Extract structured table data from the page the user is viewing. Use this when the user asks you to read a table, get spreadsheet data, or extract tabular information from a web page.",
  tier: "pro",
  inputSchema: {
    selector: external_exports.string().optional().describe("CSS selector for a specific table"),
    index: external_exports.number().default(0).describe("Table index if multiple tables exist (default: first)"),
    tab_id: external_exports.string().describe('Required. Tab ID returned by `list_tabs` (format: "<brand>:<uuid>:<rawId>"). Call `list_tabs` first if you do not have one.')
  }
};

// src/tools/read-form.ts
var readForm = {
  name: "read_form",
  description: "Read all form fields on the page the user is viewing. Returns structured metadata about every input, select, textarea, and contenteditable field \u2014 including labels, types, current values, and options. Use this before fill_form to understand what fields exist and how to target them.",
  tier: "pro",
  inputSchema: {
    selector: external_exports.string().optional().describe("Optional CSS selector to target a specific form"),
    tab_id: external_exports.string().describe('Required. Tab ID returned by `list_tabs` (format: "<brand>:<uuid>:<rawId>"). Call `list_tabs` first if you do not have one.')
  }
};

// src/tools/extract-data.ts
var extractData = {
  name: "extract_data",
  description: "Extract structured or repeating data from any page \u2014 not just HTML tables. Detects card grids, product listings, search results, flex layouts, and classic tables using heuristic pattern detection. Returns the best-matching data region with headers and rows. Use this when the user asks to scrape data, extract listings, or get structured information from a page.",
  tier: "pro",
  inputSchema: {
    selector: external_exports.string().optional().describe("Optional CSS selector to target a specific container"),
    columns: external_exports.array(external_exports.string()).optional().describe("Optional column name hints to help match the right data region"),
    format: external_exports.enum(["table", "json"]).default("table").describe("Output format (default: table)"),
    max_rows: external_exports.number().default(100).describe("Maximum number of rows to extract (default: 100)"),
    include_links: external_exports.boolean().default(false).describe("Include href URLs in extracted data"),
    tab_id: external_exports.string().describe('Required. Tab ID returned by `list_tabs` (format: "<brand>:<uuid>:<rawId>"). Call `list_tabs` first if you do not have one.')
  }
};

// src/tools/scroll-page.ts
var scrollPage = {
  name: "scroll_page",
  description: "Scroll the page in a direction, to a CSS selector, or to specific text. Returns scroll position and newly visible content. Use this to read content below the fold, find elements on long pages, or handle infinite scroll.",
  tier: "pro",
  inputSchema: {
    direction: external_exports.enum(["up", "down", "top", "bottom"]).optional().describe('Scroll direction. "up"/"down" scroll by one viewport height. "top"/"bottom" scroll to page extremes.'),
    amount: external_exports.number().optional().describe("Pixels to scroll (overrides direction default of one viewport height). Positive = down, negative = up."),
    selector: external_exports.string().optional().describe("CSS selector \u2014 scroll element into center of viewport."),
    text: external_exports.string().optional().describe("Find text on page (case-insensitive) and scroll to it."),
    wait_for_content: external_exports.boolean().optional().default(true).describe("Wait for lazy-loaded content to settle after scroll. Default: true."),
    tab_id: external_exports.string().describe('Required. Tab ID returned by `list_tabs` (format: "<brand>:<uuid>:<rawId>"). Call `list_tabs` first if you do not have one.')
  }
};

// src/tools/go-back.ts
var goBack = {
  name: "go_back",
  description: "Navigate back in browser history (like clicking the back button). Use this when the user wants to return to a previous page.",
  tier: "pro",
  inputSchema: {
    wait_until: external_exports.enum(["load", "domcontentloaded"]).optional().default("domcontentloaded").describe('When to consider navigation complete. Default: "domcontentloaded".'),
    tab_id: external_exports.string().describe('Required. Tab ID returned by `list_tabs` (format: "<brand>:<uuid>:<rawId>"). Call `list_tabs` first if you do not have one.')
  }
};

// src/tools/go-forward.ts
var goForward = {
  name: "go_forward",
  description: "Navigate forward in browser history. Use this after going back to return to where you were.",
  tier: "pro",
  inputSchema: {
    wait_until: external_exports.enum(["load", "domcontentloaded"]).optional().default("domcontentloaded").describe('When to consider navigation complete. Default: "domcontentloaded".'),
    tab_id: external_exports.string().describe('Required. Tab ID returned by `list_tabs` (format: "<brand>:<uuid>:<rawId>"). Call `list_tabs` first if you do not have one.')
  }
};

// src/tools/snapshot.ts
var snapshot = {
  name: "snapshot",
  description: "Capture an accessibility snapshot of the current page. Returns a YAML tree of all interactive elements (buttons, links, inputs, forms) with their roles, labels, and states (checked, disabled, required, invalid). Use this to understand the page structure before interacting, or to see what changed after an action.",
  tier: "free",
  inputSchema: {
    tab_id: external_exports.string().describe('Required. Tab ID returned by `list_tabs` (format: "<brand>:<uuid>:<rawId>"). Call `list_tabs` first if you do not have one.')
  }
};

// src/tools/index.ts
var toolRegistry = [
  getPageContent,
  getPageMetadata,
  takeScreenshot,
  snapshot,
  listTabs,
  navigate,
  fillForm,
  clickElement,
  pressKey,
  extractTable,
  readForm,
  extractData,
  scrollPage,
  goBack,
  goForward
];

// src/version.ts
var VERSION = "0.5.12";
var BUILD_ID = process.env.BUILD_ID ?? "dev";

// src/lock-file-manager.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var import_node_os = require("node:os");
function getLockDir() {
  switch ((0, import_node_os.platform)()) {
    case "win32":
      return (0, import_node_path.join)(process.env.LOCALAPPDATA ?? (0, import_node_path.join)((0, import_node_os.homedir)(), "AppData", "Local"), "agenthub");
    case "darwin":
      return (0, import_node_path.join)((0, import_node_os.homedir)(), "Library", "Application Support", "agenthub");
    default:
      return (0, import_node_path.join)((0, import_node_os.homedir)(), ".local", "share", "agenthub");
  }
}
function getLockFilePath() {
  return (0, import_node_path.join)(getLockDir(), "server.lock");
}
function writeLockFile(data, lockPath) {
  const filePath = lockPath ?? getLockFilePath();
  const dir = (0, import_node_path.join)(filePath, "..");
  if (!(0, import_node_fs.existsSync)(dir)) {
    (0, import_node_fs.mkdirSync)(dir, { recursive: true });
  }
  (0, import_node_fs.writeFileSync)(filePath, JSON.stringify(data, null, 2), "utf-8");
}
function deleteLockFile(lockPath) {
  const filePath = lockPath ?? getLockFilePath();
  try {
    (0, import_node_fs.unlinkSync)(filePath);
  } catch {
  }
}
function registerCleanupHandlers(lockPath) {
  const cleanup = () => deleteLockFile(lockPath);
  process.on("exit", cleanup);
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("uncaughtException", (err) => {
    cleanup();
    throw err;
  });
  process.on("unhandledRejection", (reason) => {
    cleanup();
    throw reason;
  });
}

// src/shared/logger.ts
var import_node_fs2 = require("node:fs");
var import_node_path2 = require("node:path");
var DEFAULT_MAX_BYTES = 1e6;
var DEFAULT_KEEP = 4;
var MAX_LINE_BYTES = 16e3;
var _remoteTee = null;
function setRemoteTee(fn) {
  _remoteTee = fn;
}
var _loggingEnabled = null;
function isLoggingEnabled(filePath) {
  if (_loggingEnabled !== null) return _loggingEnabled;
  try {
    const configPath = (0, import_node_path2.join)((0, import_node_path2.dirname)((0, import_node_path2.dirname)(filePath)), "logs-config.json");
    if (!(0, import_node_fs2.existsSync)(configPath)) {
      _loggingEnabled = true;
      return true;
    }
    const raw = (0, import_node_fs2.readFileSync)(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    _loggingEnabled = parsed.enabled !== false;
    return _loggingEnabled;
  } catch {
    _loggingEnabled = true;
    return true;
  }
}
var states = /* @__PURE__ */ new Map();
function getOrInit(cfg2) {
  const existing = states.get(cfg2.filePath);
  if (existing) return existing;
  const state = {
    filePath: cfg2.filePath,
    maxBytes: cfg2.maxBytes ?? DEFAULT_MAX_BYTES,
    keep: cfg2.keep ?? DEFAULT_KEEP,
    currentBytes: 0,
    disabled: false
  };
  try {
    const dir = (0, import_node_path2.dirname)(cfg2.filePath);
    if (!(0, import_node_fs2.existsSync)(dir)) (0, import_node_fs2.mkdirSync)(dir, { recursive: true });
  } catch {
    state.disabled = true;
    states.set(cfg2.filePath, state);
    return state;
  }
  try {
    if ((0, import_node_fs2.existsSync)(cfg2.filePath)) {
      state.currentBytes = (0, import_node_fs2.statSync)(cfg2.filePath).size;
    }
  } catch {
  }
  states.set(cfg2.filePath, state);
  return state;
}
function rotate(state) {
  const { filePath, keep } = state;
  try {
    if ((0, import_node_fs2.existsSync)(`${filePath}.${keep}`)) (0, import_node_fs2.unlinkSync)(`${filePath}.${keep}`);
  } catch {
  }
  for (let i = keep - 1; i >= 1; i--) {
    try {
      if ((0, import_node_fs2.existsSync)(`${filePath}.${i}`)) {
        (0, import_node_fs2.renameSync)(`${filePath}.${i}`, `${filePath}.${i + 1}`);
      }
    } catch {
      return false;
    }
  }
  try {
    if ((0, import_node_fs2.existsSync)(filePath)) {
      (0, import_node_fs2.renameSync)(filePath, `${filePath}.1`);
    }
  } catch {
    return false;
  }
  return true;
}
function serialize(rec) {
  if (!rec.t) rec.t = (/* @__PURE__ */ new Date()).toISOString();
  let line;
  try {
    line = JSON.stringify(rec);
  } catch {
    line = JSON.stringify({
      t: rec.t,
      src: rec.src,
      lvl: rec.lvl,
      pid: rec.pid,
      event: rec.event,
      _serialize_failed: true
    });
  }
  if (Buffer.byteLength(line, "utf-8") > MAX_LINE_BYTES) {
    line = JSON.stringify({
      t: rec.t,
      src: rec.src,
      lvl: rec.lvl,
      pid: rec.pid,
      event: rec.event,
      _truncated: true,
      _originalBytes: Buffer.byteLength(line, "utf-8")
    });
  }
  return line + "\n";
}
function logRecord(cfg2, rec) {
  if (!isLoggingEnabled(cfg2.filePath)) return;
  if (_remoteTee) {
    try {
      _remoteTee(rec);
    } catch {
    }
  }
  const state = getOrInit(cfg2);
  if (state.disabled) return;
  const line = serialize(rec);
  const bytes = Buffer.byteLength(line, "utf-8");
  if (state.currentBytes + bytes > state.maxBytes) {
    if (rotate(state)) {
      state.currentBytes = 0;
    }
  }
  try {
    (0, import_node_fs2.appendFileSync)(state.filePath, line, "utf-8");
    state.currentBytes += bytes;
  } catch {
  }
}
function stripReservedKeys(fields) {
  if (!fields) return {};
  const { pid: _pid, src: _src, lvl: _lvl, event: _event, t: _t, ...rest } = fields;
  return rest;
}
function makeLogger(cfg2, src, pid) {
  return {
    info(event, fields) {
      logRecord(cfg2, { src, lvl: "info", pid, event, ...stripReservedKeys(fields) });
    },
    warn(event, fields) {
      logRecord(cfg2, { src, lvl: "warn", pid, event, ...stripReservedKeys(fields) });
    },
    error(event, fields) {
      logRecord(cfg2, { src, lvl: "error", pid, event, ...stripReservedKeys(fields) });
    }
  };
}

// src/remote-sink.ts
var import_node_fs3 = require("node:fs");
var import_node_https = require("node:https");
var import_node_http = require("node:http");
var import_node_path3 = require("node:path");
var import_node_crypto = require("node:crypto");
var import_node_url = require("node:url");
var DEFAULTS = {
  flushIntervalMs: 5e3,
  maxBatch: 50,
  maxBufferRecords: 1e3,
  /** Hard cap on a single POST so one flush can't send a huge body. */
  postTimeoutMs: 8e3
};
var cfg = null;
var buffer = [];
var timer = null;
var flushing = false;
function num(v, fallback) {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
}
function readRemoteConfig(installDir) {
  try {
    const raw = (0, import_node_fs3.readFileSync)((0, import_node_path3.join)(installDir, "logs-config.json"), "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed.enabled === false) return null;
    const r = parsed.remote;
    if (!r || r.enabled !== true) return null;
    if (typeof r.endpoint !== "string" || typeof r.apiKey !== "string") return null;
    if (!r.endpoint || !r.apiKey) return null;
    return {
      endpoint: r.endpoint,
      apiKey: r.apiKey,
      flushIntervalMs: num(r.flushIntervalMs, DEFAULTS.flushIntervalMs),
      maxBatch: num(r.maxBatch, DEFAULTS.maxBatch),
      maxBufferRecords: num(r.maxBufferRecords, DEFAULTS.maxBufferRecords)
    };
  } catch {
    return null;
  }
}
function getInstallId(installDir) {
  const p = (0, import_node_path3.join)(installDir, "install-id");
  try {
    if ((0, import_node_fs3.existsSync)(p)) {
      const existing = (0, import_node_fs3.readFileSync)(p, "utf-8").trim();
      if (existing) return existing;
    }
  } catch {
  }
  const id = (0, import_node_crypto.randomUUID)();
  try {
    (0, import_node_fs3.writeFileSync)(p, id, "utf-8");
  } catch {
  }
  return id;
}
function postBatch(endpoint, apiKey, body) {
  return new Promise((resolve) => {
    let u;
    try {
      u = new import_node_url.URL(endpoint);
    } catch {
      return resolve();
    }
    const lib = u.protocol === "http:" ? import_node_http.request : import_node_https.request;
    const payload = Buffer.from(body, "utf-8");
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    try {
      const req = lib(
        {
          method: "POST",
          hostname: u.hostname,
          port: u.port || void 0,
          path: u.pathname + u.search,
          headers: {
            "content-type": "application/json",
            "content-length": payload.length,
            "x-ingest-key": apiKey
          },
          timeout: DEFAULTS.postTimeoutMs
        },
        (res) => {
          res.on("data", () => {
          });
          res.on("end", done);
          res.on("error", done);
        }
      );
      req.on("error", done);
      req.on("timeout", () => {
        req.destroy();
        done();
      });
      req.write(payload);
      req.end();
    } catch {
      done();
    }
  });
}
function enqueue(rec) {
  if (!cfg) return;
  const copy = { ...rec };
  if (!copy.t) copy.t = (/* @__PURE__ */ new Date()).toISOString();
  buffer.push(copy);
  if (buffer.length > cfg.maxBufferRecords) {
    buffer.splice(0, buffer.length - cfg.maxBufferRecords);
  }
  if (buffer.length >= cfg.maxBatch) void flush();
}
async function flush() {
  if (flushing || !cfg || buffer.length === 0) return;
  flushing = true;
  const active = cfg;
  const batch = buffer.splice(0, active.maxBatch);
  try {
    const body = JSON.stringify({ installId: active.installId, records: batch });
    await postBatch(active.endpoint, active.apiKey, body);
  } catch {
  } finally {
    flushing = false;
  }
}
var shutdownHooked = false;
function initRemoteSink(installDir) {
  const rc = readRemoteConfig(installDir);
  if (!rc) {
    cfg = null;
    setRemoteTee(null);
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    return;
  }
  cfg = { ...rc, installId: getInstallId(installDir) };
  buffer = [];
  setRemoteTee(enqueue);
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    void flush();
  }, cfg.flushIntervalMs);
  if (typeof timer.unref === "function") timer.unref();
  if (!shutdownHooked) {
    shutdownHooked = true;
    process.once("beforeExit", () => {
      void flush();
    });
    process.once("SIGINT", () => {
      void flush();
    });
    process.once("SIGTERM", () => {
      void flush();
    });
  }
}

// src/shared/redaction.ts
var URL_KEYS = /* @__PURE__ */ new Set([
  "url",
  "href",
  "targeturl",
  "link",
  "location",
  "src",
  // NOTE: `action` was deliberately removed (it was originally added with
  // HTML `<form action="...">` in mind). In practice the field name
  // `action` appears far more often as a verb in our codebase
  // (e.g. helper RPC actions like 'get_service_status', 'start_native_host')
  // than as a URL. Callers that genuinely log a form action should pass
  // it under one of the URL_KEYS names instead (e.g. `formActionUrl`).
  "referrer",
  "redirecturi"
]);
var TEXT_KEYS = /* @__PURE__ */ new Set([
  "value",
  "values",
  "text",
  "body",
  "content",
  "innertext",
  "innerhtml",
  "outerhtml",
  "title",
  "pagetitle",
  "query",
  "searchquery",
  "q",
  "label",
  "name",
  "placeholder",
  "description",
  "alt",
  "visibletext",
  "snapshot",
  "ariasnapshot",
  "pagecontent",
  "selector",
  "css",
  "xpath",
  "message"
]);
var RECORD_ARRAY_KEYS = /* @__PURE__ */ new Set([
  "rows",
  "cells",
  "data",
  "entries",
  "items",
  "results",
  "tabs",
  "records"
]);
var SECRET_KEYS = /* @__PURE__ */ new Set([
  "cookie",
  "cookies",
  "authorization",
  "auth",
  "token",
  "apikey",
  "api_key",
  "password",
  "pwd",
  "secret",
  "privatekey",
  "private_key",
  "sessionid",
  "session_id",
  "csrf"
]);
var RECURSE_KEYS = /* @__PURE__ */ new Set([
  "metadata",
  "meta",
  "og",
  "opengraph",
  "options",
  "config",
  "params",
  "arguments",
  "request",
  "response",
  "result",
  "context"
]);
var URL_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s/$.?#].\S*$/;
var URL_SUBSTRING_RE = /https?:\/\/[^\s'"\)<>]+/g;
var JWT_RE = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,}$/;
var MAX_STRING_LEN = 200;
function redact(value, depth = 0) {
  if (depth > 16) return "[deep-truncated]";
  if (value === null || value === void 0) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) {
    return value.map((v) => redact(v, depth + 1));
  }
  if (typeof value === "object") {
    return redactObject(value, depth);
  }
  return `[${typeof value}]`;
}
function redactString(s) {
  if (s.length === 0) return s;
  if (JWT_RE.test(s)) return "[REDACTED-JWT]";
  if (URL_RE.test(s)) return redactUrl(s);
  if (s.length > MAX_STRING_LEN) return `[len=${s.length}]`;
  if (URL_SUBSTRING_RE.test(s)) {
    URL_SUBSTRING_RE.lastIndex = 0;
    return s.replace(URL_SUBSTRING_RE, (match) => redactUrl(match));
  }
  return s;
}
function redactObject(obj, depth) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = k.toLowerCase();
    if (SECRET_KEYS.has(key)) {
      out[k] = "[REDACTED-SECRET]";
      continue;
    }
    if (URL_KEYS.has(key)) {
      if (typeof v === "string") {
        out[k] = redactUrl(v);
      } else {
        out[k] = redact(v, depth + 1);
      }
      continue;
    }
    if (TEXT_KEYS.has(key)) {
      out[k] = lengthSummary(v);
      continue;
    }
    if (RECORD_ARRAY_KEYS.has(key)) {
      out[k] = recordArraySummary(v);
      continue;
    }
    if (RECURSE_KEYS.has(key)) {
      out[k] = redact(v, depth + 1);
      continue;
    }
    out[k] = redact(v, depth + 1);
  }
  return out;
}
function redactUrl(s) {
  try {
    const u = new URL(s);
    return `${u.protocol}//${u.host}/[redacted]`;
  } catch {
    return `[len=${s.length}]`;
  }
}
function lengthSummary(v) {
  if (v === null || v === void 0) return `[empty]`;
  if (typeof v === "string") return `[len=${v.length}]`;
  if (Array.isArray(v)) return `[arrayLen=${v.length}]`;
  if (typeof v === "object") {
    const keys = Object.keys(v);
    return `[objKeys=${keys.length}]`;
  }
  return `[${typeof v}]`;
}
function recordArraySummary(v) {
  if (!Array.isArray(v)) {
    return redact(v);
  }
  if (v.length === 0) return "[arrayLen=0]";
  const first = v[0];
  if (first && typeof first === "object" && !Array.isArray(first)) {
    const keys = Object.keys(first).slice(0, 5);
    return `[arrayLen=${v.length}, sampleKeys=[${keys.join(", ")}]]`;
  }
  return `[arrayLen=${v.length}]`;
}
function redactError(err) {
  if (err instanceof Error) {
    const code = err.code;
    return {
      errorName: err.name || "Error",
      errorMessage: redactString(err.message ?? ""),
      ...typeof code === "string" ? { errorCode: code } : {},
      ...err.stack ? { stack: redactStack(err.stack) } : {}
    };
  }
  if (typeof err === "string") {
    return { errorName: "StringError", errorMessage: redactString(err) };
  }
  if (err && typeof err === "object") {
    const obj = err;
    return {
      errorName: typeof obj.name === "string" ? obj.name : "ObjectError",
      errorMessage: redactString(typeof obj.message === "string" ? obj.message : ""),
      ...typeof obj.code === "string" ? { errorCode: obj.code } : {},
      ...typeof obj.stack === "string" ? { stack: redactStack(obj.stack) } : {}
    };
  }
  return { errorName: "UnknownError", errorMessage: `[${typeof err}]` };
}
function redactStack(stack) {
  const lines = stack.split("\n").slice(0, 20);
  const redacted = lines.map((line) => {
    URL_SUBSTRING_RE.lastIndex = 0;
    return line.replace(URL_SUBSTRING_RE, (match) => redactUrl(match));
  });
  return redacted.join("\n");
}

// src/diag-server.ts
var import_node_fs4 = require("node:fs");

// src/diag-page.ts
var DIAG_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AgentHub \u2014 Health</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; height: 100%; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #0f172a; }
  body { padding: 24px; max-width: 1280px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 4px; font-weight: 700; }
  h1 .emoji { font-size: 26px; }
  .subtitle { color: #64748b; font-size: 14px; margin: 0 0 24px; }
  .row-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .pill { background: #e2e8f0; padding: 4px 10px; border-radius: 12px; font-size: 12px; color: #475569; }
  .pill.live { background: #dcfce7; color: #166534; }
  .pill.live::before { content: '\u25CF '; color: #16a34a; animation: blink 2s ease-in-out infinite; }
  @keyframes blink { 50% { opacity: 0.4; } }

  /* \u2500\u2500 Component flow \u2500\u2500\u2500 */
  .flow { display: grid; grid-template-columns: 1fr 56px 1fr 56px 1fr 56px 1fr; gap: 0; align-items: stretch; margin: 24px 0; }
  .card { background: white; border-radius: 16px; padding: 20px 18px; border: 2px solid #e2e8f0; display: flex; flex-direction: column; min-height: 180px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); transition: transform 0.15s ease; }
  .card.ok { border-color: #86efac; background: #f0fdf4; }
  .card.warn { border-color: #fcd34d; background: #fefce8; }
  .card.bad { border-color: #fca5a5; background: #fef2f2; }
  .card.idle { border-color: #cbd5e1; background: #f1f5f9; }
  .card-emoji { font-size: 36px; line-height: 1; margin-bottom: 12px; }
  .card-title { font-weight: 600; font-size: 15px; margin: 0; }
  .card-subtitle { color: #64748b; font-size: 12px; margin: 2px 0 12px; }
  .status-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-weight: 600; font-size: 12px; align-self: flex-start; }
  .status-badge.ok { background: #86efac; color: #052e16; }
  .status-badge.warn { background: #fcd34d; color: #422006; }
  .status-badge.bad { background: #fca5a5; color: #450a0a; }
  .status-badge.idle { background: #cbd5e1; color: #1e293b; }
  .card-meta { margin-top: auto; font-size: 12px; color: #64748b; padding-top: 8px; line-height: 1.5; }
  .card-meta b { color: #0f172a; font-weight: 500; }
  .card-actions { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
  .btn { background: white; border: 1px solid #cbd5e1; padding: 6px 12px; border-radius: 8px; font-size: 12px; cursor: pointer; color: #0f172a; font-weight: 500; transition: all 0.15s; }
  .btn:hover { background: #f1f5f9; border-color: #94a3b8; }
  .btn.primary { background: #3b82f6; border-color: #2563eb; color: white; }
  .btn.primary:hover { background: #2563eb; }
  .btn.danger { background: #fee2e2; border-color: #fca5a5; color: #991b1b; }
  .btn.danger:hover { background: #fecaca; }

  /* Connection arrows between cards */
  .arrow { display: flex; align-items: center; justify-content: center; position: relative; }
  .arrow-line { position: relative; width: 100%; height: 2px; background: #cbd5e1; }
  .arrow-line::after { content: ''; position: absolute; right: -1px; top: -5px; border-left: 8px solid #cbd5e1; border-top: 6px solid transparent; border-bottom: 6px solid transparent; }
  .arrow.ok .arrow-line { background: #16a34a; }
  .arrow.ok .arrow-line::after { border-left-color: #16a34a; }
  .arrow.bad .arrow-line { background: #dc2626; }
  .arrow.bad .arrow-line::after { border-left-color: #dc2626; }
  .arrow-label { position: absolute; top: -22px; font-size: 11px; color: #64748b; white-space: nowrap; }

  /* \u2500\u2500 Recent activity \u2500\u2500\u2500 */
  .activity { background: white; border-radius: 16px; padding: 20px; margin-bottom: 24px; border: 1px solid #e2e8f0; }
  .section-title { font-size: 16px; font-weight: 600; margin: 0 0 12px; display: flex; align-items: center; gap: 8px; }
  .activity-list { display: flex; flex-direction: column; gap: 6px; max-height: 260px; overflow-y: auto; }
  .activity-empty { color: #94a3b8; font-style: italic; padding: 16px 0; text-align: center; }
  .activity-row { display: grid; grid-template-columns: 80px 36px 1fr auto auto; gap: 12px; align-items: center; padding: 8px 12px; border-radius: 8px; background: #f8fafc; font-size: 13px; }
  .activity-row.success { background: #f0fdf4; }
  .activity-row.error { background: #fef2f2; }
  .activity-row.pending { background: #fefce8; }
  .activity-time { color: #94a3b8; font-family: ui-monospace, "Cascadia Code", monospace; font-size: 11px; }
  .activity-emoji { font-size: 18px; }
  .activity-desc { color: #0f172a; }
  .activity-desc b { font-weight: 600; }
  .activity-target { color: #64748b; font-size: 12px; padding: 2px 8px; background: #e2e8f0; border-radius: 6px; }
  .activity-dur { color: #475569; font-family: ui-monospace, "Cascadia Code", monospace; font-size: 11px; }

  /* \u2500\u2500 Logs viewer \u2500\u2500\u2500 */
  .logs { background: white; border-radius: 16px; padding: 20px; border: 1px solid #e2e8f0; }
  .tabs { display: flex; gap: 4px; margin-bottom: 12px; border-bottom: 1px solid #e2e8f0; }
  .tab { padding: 8px 16px; border: none; background: transparent; cursor: pointer; font-size: 13px; color: #64748b; font-weight: 500; border-bottom: 2px solid transparent; }
  .tab.active { color: #2563eb; border-bottom-color: #2563eb; }
  .tab .count { background: #e2e8f0; color: #475569; padding: 1px 8px; border-radius: 10px; font-size: 11px; margin-left: 6px; }
  .tab.active .count { background: #dbeafe; color: #1e40af; }
  .logs-controls { display: flex; gap: 8px; margin-bottom: 8px; }
  .logs-search { flex: 1; padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 13px; font-family: inherit; }
  .logs-view { background: #0f172a; color: #e2e8f0; padding: 14px; border-radius: 8px; font-family: ui-monospace, "Cascadia Code", monospace; font-size: 11px; max-height: 360px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; line-height: 1.5; }
  .logs-view .lvl-info { color: #93c5fd; }
  .logs-view .lvl-warn { color: #fcd34d; }
  .logs-view .lvl-error { color: #fca5a5; }
  .logs-view .ev { color: #c4b5fd; font-weight: 600; }
  .logs-view .t { color: #64748b; }
  .logs-empty { color: #94a3b8; font-style: italic; padding: 24px; text-align: center; }

  /* \u2500\u2500 Toast \u2500\u2500\u2500 */
  .toast { position: fixed; bottom: 24px; right: 24px; background: #0f172a; color: white; padding: 12px 20px; border-radius: 12px; font-size: 14px; box-shadow: 0 8px 24px rgba(0,0,0,0.2); opacity: 0; transform: translateY(20px); transition: all 0.3s; z-index: 1001; }
  .toast.show { opacity: 1; transform: translateY(0); }
  .toast.error { background: #991b1b; }

  /* \u2500\u2500 Activity row click affordance \u2500\u2500\u2500 */
  .activity-row { cursor: pointer; transition: transform 0.1s; }
  .activity-row:hover { transform: translateX(4px); }
  .activity-row::after { content: '\u25B8'; color: #94a3b8; margin-left: 8px; }

  /* \u2500\u2500 Drill-down modal \u2500\u2500\u2500 */
  .modal-overlay {
    position: fixed; inset: 0; background: rgba(15, 23, 42, 0.55);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000; padding: 24px;
    opacity: 0; pointer-events: none; transition: opacity 0.2s;
  }
  .modal-overlay.open { opacity: 1; pointer-events: auto; }
  .modal {
    background: white; border-radius: 16px; padding: 24px;
    max-width: 720px; width: 100%; max-height: 85vh; overflow-y: auto;
    box-shadow: 0 24px 64px rgba(0,0,0,0.3);
    transform: translateY(20px); transition: transform 0.2s;
  }
  .modal-overlay.open .modal { transform: translateY(0); }
  .modal-header {
    display: flex; justify-content: space-between; align-items: flex-start;
    margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #e2e8f0;
  }
  .modal-title { font-size: 18px; font-weight: 700; margin: 0; }
  .modal-title-sub { color: #64748b; font-size: 13px; margin: 4px 0 0; }
  .modal-close {
    background: transparent; border: 0; cursor: pointer; padding: 4px 10px;
    font-size: 20px; color: #64748b; line-height: 1; border-radius: 8px;
  }
  .modal-close:hover { background: #f1f5f9; color: #0f172a; }
  .modal-summary {
    background: #f8fafc; border-radius: 10px; padding: 12px 16px; margin-bottom: 16px;
    display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px;
    font-size: 13px;
  }
  .modal-summary .lbl { color: #64748b; }
  .modal-summary .val { color: #0f172a; font-family: ui-monospace, monospace; font-size: 12px; word-break: break-all; }

  /* Step timeline */
  .steps-section-title {
    font-size: 13px; font-weight: 600; color: #475569; margin: 12px 0 8px;
    display: flex; align-items: center; gap: 6px;
  }
  .step-list { display: flex; flex-direction: column; gap: 0; position: relative; }
  .step {
    display: grid; grid-template-columns: 32px 70px 1fr; gap: 12px;
    padding: 10px 0; align-items: flex-start; position: relative;
  }
  .step:not(:last-child)::before {
    content: ''; position: absolute; left: 15px; top: 32px; bottom: -2px;
    width: 2px; background: #e2e8f0;
  }
  .step.ok:not(:last-child)::before { background: #86efac; }
  .step.fail:not(:last-child)::before { background: #fca5a5; }
  .step-icon {
    width: 32px; height: 32px; border-radius: 50%; display: flex;
    align-items: center; justify-content: center; font-size: 16px;
    flex-shrink: 0; z-index: 1;
  }
  .step.ok .step-icon { background: #dcfce7; color: #166534; }
  .step.fail .step-icon { background: #fee2e2; color: #991b1b; }
  .step.wait .step-icon { background: #fef3c7; color: #92400e; }
  .step.info .step-icon { background: #dbeafe; color: #1e40af; }
  .step-time {
    font-size: 11px; color: #94a3b8; font-family: ui-monospace, monospace;
    padding-top: 8px; line-height: 1.2;
  }
  .step-body { padding-top: 4px; }
  .step-msg { font-size: 14px; color: #0f172a; line-height: 1.5; }
  .step-cause {
    margin-top: 6px; font-size: 12px; color: #92400e; background: #fef3c7;
    border-left: 3px solid #fcd34d; padding: 6px 10px; border-radius: 4px;
  }

  /* \u2500\u2500 Responsive (narrow window) \u2500\u2500\u2500 */
  @media (max-width: 1024px) {
    .flow { grid-template-columns: 1fr; grid-template-rows: auto; }
    .arrow { transform: rotate(90deg); height: 30px; margin: 0 auto; width: 40px; }
  }

  /* \u2500\u2500 Help banner \u2500\u2500\u2500 */
  .banner { background: #dbeafe; border: 1px solid #93c5fd; border-radius: 10px; padding: 12px 16px; margin-bottom: 16px; color: #1e40af; font-size: 13px; }
  .banner b { font-weight: 600; }

  details { font-size: 12px; color: #475569; margin-top: 6px; }
  details summary { cursor: pointer; color: #64748b; }
  details code { font-family: ui-monospace, "Cascadia Code", monospace; background: #f1f5f9; padding: 1px 5px; border-radius: 4px; }

  /* \u2500\u2500 Interactive item lists (MCP clients, browsers) \u2500\u2500\u2500 */
  .item-list { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
  .item-empty { color: #64748b; font-size: 12px; font-style: italic; padding: 6px 0; }
  .item {
    background: rgba(255,255,255,0.6); border: 1px solid #e2e8f0; border-radius: 8px;
    padding: 8px 10px; font-size: 12px; cursor: pointer; transition: all 0.12s;
    display: flex; align-items: center; gap: 8px;
    text-align: left; width: 100%; font-family: inherit; color: inherit;
  }
  .item:hover { border-color: #93c5fd; background: white; }
  .item:focus-visible { outline: 2px solid #3b82f6; outline-offset: 2px; }
  .item.expanded { background: white; border-color: #3b82f6; }
  .item.item-stale { border-color: #fca5a5; background: #fef2f2; }
  .item.item-stale:hover { background: #fee2e2; }
  .item-emoji { font-size: 14px; flex-shrink: 0; }
  .item-main { flex: 1; min-width: 0; overflow: hidden; }
  .item-main b { display: block; color: #0f172a; font-weight: 600; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .item-main .item-sub { color: #64748b; font-size: 11px; }
  .item-count { font-size: 10px; color: #475569; background: #e2e8f0; padding: 2px 7px; border-radius: 999px; font-weight: 600; flex-shrink: 0; }
  .item.expanded .item-count { background: #dbeafe; color: #1e40af; }
  .item-caret { color: #94a3b8; transition: transform 0.15s; flex-shrink: 0; }
  .item.expanded .item-caret { transform: rotate(90deg); color: #3b82f6; }
  .item-detail {
    background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;
    padding: 10px 12px; font-size: 11px; color: #475569; margin-top: -2px;
    font-family: ui-monospace, "Cascadia Code", monospace; line-height: 1.6;
  }
  .item-detail .row { display: flex; gap: 8px; margin-bottom: 4px; }
  .item-detail .row:last-child { margin-bottom: 0; }
  .item-detail .label { color: #94a3b8; min-width: 90px; flex-shrink: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 11px; }
  .item-detail .val { color: #0f172a; word-break: break-all; }
  .item-detail .recent-mini {
    margin-top: 8px; padding-top: 8px; border-top: 1px dashed #cbd5e1;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .item-detail .recent-mini .mini-title { font-weight: 600; font-size: 11px; color: #475569; margin-bottom: 4px; }
  .item-detail .recent-mini .mini-row { font-size: 11px; color: #64748b; padding: 2px 0; }
  .item-detail .recent-mini .mini-row .mini-emoji { margin-right: 4px; }

  /* Brand chips shown in the Browser Extension card. Visual summary of
     which browsers have the extension running, clickable to scroll to
     the Connected Browsers card for full detail. */
  .chip-row { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
  .chip {
    background: white; border: 1px solid #cbd5e1; border-radius: 999px;
    padding: 3px 9px; font-size: 11px; color: #475569; cursor: pointer;
    display: inline-flex; align-items: center; gap: 4px;
    text-decoration: none; transition: all 0.12s;
    font-family: inherit;
  }
  .chip:hover { border-color: #3b82f6; color: #1e40af; background: #dbeafe; }
  .chip:focus-visible { outline: 2px solid #3b82f6; outline-offset: 1px; }

  /* Highlight pulse for the target card after a chip click \u2014 gives users
     visual confirmation that the click did something. */
  @keyframes flash-highlight {
    0% { box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.4); }
    100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
  }
  .card.highlight { animation: flash-highlight 1.2s ease-out; }
</style>
</head>
<body>
  <div class="row-top">
    <div>
      <h1><span class="emoji">\u{1F310}</span> AgentHub Health</h1>
      <p class="subtitle">What's running, what's talking to what, and how to fix it if something's stuck.</p>
    </div>
    <span class="pill live" id="livePill">Updating live</span>
  </div>

  <div class="banner" id="banner" style="display:none">
    <b>Heads up:</b> <span id="bannerMsg"></span>
  </div>

  <!-- \u2500\u2500 Component flow \u2500\u2500 -->
  <div class="flow" id="flow">
    <!-- 4 cards + 3 arrows interleaved, populated by JS -->
    <div class="card idle" id="card-mcp">
      <div class="card-emoji">\u{1F4AC}</div>
      <p class="card-title">Your AI Assistant</p>
      <p class="card-subtitle">Claude, Cursor, VS Code\u2026</p>
      <span class="status-badge idle">Loading\u2026</span>
      <div class="card-meta" id="mcp-meta">\u2014</div>
    </div>
    <div class="arrow"><div class="arrow-line"><span class="arrow-label">MCP requests</span></div></div>
    <div class="card idle" id="card-bridge">
      <div class="card-emoji">\u{1F309}</div>
      <p class="card-title">Bridge</p>
      <p class="card-subtitle">Connects everything</p>
      <span class="status-badge idle">Loading\u2026</span>
      <div class="card-meta" id="bridge-meta">\u2014</div>
      <div class="card-actions">
        <button class="btn primary" onclick="action('restart-bridge')">Restart</button>
      </div>
    </div>
    <div class="arrow"><div class="arrow-line"><span class="arrow-label">WebSocket</span></div></div>
    <div class="card idle" id="card-ext">
      <div class="card-emoji">\u{1F9E9}</div>
      <p class="card-title">Browser Extension</p>
      <p class="card-subtitle">AgentHub running inside browsers</p>
      <span class="status-badge idle">Loading\u2026</span>
      <div class="card-meta" id="ext-meta">\u2014</div>
      <div class="card-actions">
        <button class="btn" onclick="action('reload-extension')" title="Reload AgentHub extension in every connected browser">Reload all</button>
      </div>
    </div>
    <div class="arrow"><div class="arrow-line"><span class="arrow-label">Per-browser</span></div></div>
    <div class="card idle" id="card-browser">
      <div class="card-emoji">\u{1F30D}</div>
      <p class="card-title">Connected Browsers</p>
      <p class="card-subtitle">Click each for details</p>
      <span class="status-badge idle">Loading\u2026</span>
      <div class="card-meta" id="browser-meta">\u2014</div>
    </div>
  </div>

  <!-- \u2500\u2500 Recent activity \u2500\u2500 -->
  <div class="activity">
    <p class="section-title">\u{1F4CA} Recent Activity <span class="pill" id="activity-count">0 actions</span></p>
    <div class="activity-list" id="activity-list">
      <div class="activity-empty">No activity yet. Try asking your AI assistant to do something.</div>
    </div>
  </div>

  <!-- \u2500\u2500 Logs \u2500\u2500 -->
  <div class="logs">
    <p class="section-title">\u{1F4DC} Logs</p>
    <div class="tabs">
      <button class="tab active" data-tab="bridge" onclick="switchTab('bridge')">Bridge <span class="count" id="count-bridge">\u2014</span></button>
      <button class="tab" data-tab="extension" onclick="switchTab('extension')">Extension <span class="count" id="count-extension">\u2014</span></button>
      <button class="tab" data-tab="helper" onclick="switchTab('helper')">Helper <span class="count" id="count-helper">\u2014</span></button>
    </div>
    <div class="logs-controls">
      <input class="logs-search" id="logs-search" placeholder="Filter (e.g. tools_call, error, mcpId)\u2026" oninput="renderLogs()">
      <button class="btn" onclick="loadLogs()">Refresh</button>
    </div>
    <div class="logs-view" id="logs-view">
      <div class="logs-empty">Loading\u2026</div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <!-- Drill-down modal: opens when user clicks a row in Recent Activity. -->
  <div class="modal-overlay" id="modalOverlay" onclick="closeModal(event)">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-header">
        <div>
          <p class="modal-title" id="modalTitle">Request details</p>
          <p class="modal-title-sub" id="modalSubtitle">\u2014</p>
        </div>
        <button class="modal-close" onclick="closeModal()" aria-label="Close">\u2715</button>
      </div>
      <div class="modal-summary" id="modalSummary"></div>
      <div class="steps-section-title">\u{1F4CB} What happened, step by step</div>
      <div class="step-list" id="modalSteps"></div>
    </div>
  </div>

<script>
"use strict";
const POLL_MS = 1500;
let state = { state: null, logs: { bridge: [], extension: [], helper: [] }, currentTab: 'bridge', openItems: new Set() };

// \u2500\u2500 Utilities \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtRelTime(ts) {
  const ms = Date.now() - new Date(ts).getTime();
  if (ms < 60000) return Math.floor(ms / 1000) + 's ago';
  if (ms < 3600000) return Math.floor(ms / 60000) + 'm ago';
  return Math.floor(ms / 3600000) + 'h ago';
}
function fmtUptime(s) {
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s/60) + 'm ' + (s%60) + 's';
  return Math.floor(s/3600) + 'h ' + Math.floor((s%3600)/60) + 'm';
}
function toast(msg, isError) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (isError ? ' error' : '');
  setTimeout(() => el.className = 'toast' + (isError ? ' error' : ''), 3500);
}
function setStatus(cardId, status, label) {
  const card = document.getElementById('card-' + cardId);
  card.classList.remove('ok', 'warn', 'bad', 'idle');
  card.classList.add(status);
  const badge = card.querySelector('.status-badge');
  badge.className = 'status-badge ' + status;
  badge.textContent = label;
}
function setArrow(idx, status) {
  const arrows = document.querySelectorAll('.arrow');
  const a = arrows[idx];
  if (!a) return;
  a.classList.remove('ok', 'bad');
  if (status) a.classList.add(status);
}

// \u2500\u2500 Polling /api/state \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
async function poll() {
  try {
    const r = await fetch('/api/state');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    state.state = await r.json();
    render();
  } catch (err) {
    document.getElementById('livePill').textContent = 'Offline \u2014 bridge not responding';
    document.getElementById('livePill').classList.remove('live');
    setStatus('bridge', 'bad', 'Off');
    setStatus('ext', 'idle', 'Unknown');
    setStatus('browser', 'idle', 'Unknown');
    setStatus('mcp', 'idle', 'Unknown');
  }
}

function render() {
  const s = state.state;
  if (!s) return;
  // Bridge
  setStatus('bridge', 'ok', 'On \u2014 v' + s.bridge.version);
  document.getElementById('bridge-meta').innerHTML =
    '<b>Port:</b> ' + s.bridge.port + ' &nbsp; <b>PID:</b> ' + s.bridge.pid + '<br><b>Up:</b> ' + fmtUptime(s.bridge.uptimeSec) +
    '<details><summary>More</summary>Build: ' + esc(s.bridge.buildId) + '<br>Started by: ' + esc(s.bridge.startedBy) + '<br>Allowlist: ' + s.bridge.allowedExtensionIdsCount + ' ID(s)</details>';

  // MCP clients \u2014 interactive list (click to expand details)
  const mcpCount = s.mcpClients.length;
  setStatus('mcp', mcpCount > 0 ? 'ok' : 'idle', mcpCount + ' connected');
  if (mcpCount === 0) {
    document.getElementById('mcp-meta').innerHTML =
      '<div class="item-empty">No AI assistant connected yet.</div>' +
      '<details><summary>How to connect</summary>Configure Claude / Cursor / VS Code with MCP server <code>agenthub</code>.</details>';
  } else {
    document.getElementById('mcp-meta').innerHTML =
      '<div class="item-list">' + s.mcpClients.map((c, i) =>
        renderClientItem(c, i, s.recentRequests || [])
      ).join('') + '</div>';
    // Auto-expand if there are few clients \u2014 info more useful visible.
    if (mcpCount <= 3) {
      s.mcpClients.forEach((_, i) => state.openItems.add('mcp-' + i));
    }
  }

  // Extension card \u2014 replaces the misleading "see next \u2192" with actual
  // brand chips. Each chip is a real button that scrolls to + highlights
  // the matching browser in the Connected Browsers card, then expands it.
  // (Status badge is set further down, derived from per-browser liveness.)
  const extCount = s.browsers.length;
  if (extCount === 0) {
    document.getElementById('ext-meta').innerHTML =
      '<div class="item-empty">No browser extension connected.</div>' +
      '<details><summary>How to fix</summary>1. Open Chrome / Edge<br>2. Open the AgentHub side panel<br>3. Wait ~5 seconds</details>';
  } else {
    const brandCounts = {};
    s.browsers.forEach(b => {
      const brand = b.browserId.split(':')[0] || 'browser';
      brandCounts[brand] = (brandCounts[brand] || 0) + 1;
    });
    const chips = Object.entries(brandCounts).map(([brand, count]) =>
      '<button class="chip" onclick="scrollToBrowser(\\'' + esc(brand) + '\\')" title="Click for details">' +
        browserBrandEmoji(brand) + ' ' + esc(brand) + (count > 1 ? ' \xD7' + count : '') +
      '</button>'
    ).join('');
    document.getElementById('ext-meta').innerHTML =
      '<b>' + extCount + '</b> browser' + (extCount === 1 ? '' : 's') + ' connected' +
      '<div class="chip-row">' + chips + '</div>';
  }

  // Browsers \u2014 interactive list (click each item to expand details).
  // Status is derived from LIVENESS (lastSeenAt) not socket presence \u2014
  // a "connected but stale" browser shows yellow warning instead of green.
  const liveBrowsers = s.browsers.filter(b => b.liveness === 'live').length;
  const staleBrowsers = s.browsers.filter(b => b.liveness === 'stale').length;
  const browserBadgeStatus = extCount === 0 ? 'idle' : staleBrowsers > 0 ? 'warn' : 'ok';
  const browserBadgeLabel = extCount === 0
    ? 'No browsers'
    : staleBrowsers > 0
      ? (liveBrowsers + ' live, ' + staleBrowsers + ' stuck')
      : (liveBrowsers + ' live');
  setStatus('browser', browserBadgeStatus, browserBadgeLabel);
  if (s.browsers.length === 0) {
    document.getElementById('browser-meta').innerHTML = '<div class="item-empty">No browsers yet.</div>';
  } else {
    document.getElementById('browser-meta').innerHTML =
      '<div class="item-list">' + s.browsers.map((b, i) =>
        renderBrowserItem(b, i, s.recentRequests || [])
      ).join('') + '</div>';
    if (s.browsers.length <= 3) {
      // Default-expand all browsers when there are few \u2014 clicking each one
      // individually is annoying when the info fits on screen anyway.
      s.browsers.forEach((_, i) => state.openItems.add('browser-' + i));
    }
  }

  // Also reflect stale state on the Extension card.
  const extBadgeStatus = extCount === 0 ? 'bad' : staleBrowsers > 0 ? 'warn' : 'ok';
  const extBadgeLabel = extCount === 0
    ? 'Not connected'
    : staleBrowsers > 0
      ? (liveBrowsers + ' live, ' + staleBrowsers + ' stuck')
      : 'On';
  setStatus('ext', extBadgeStatus, extBadgeLabel);

  // Arrows \u2014 yellow when stale
  setArrow(0, mcpCount > 0 ? 'ok' : null);
  setArrow(1, extCount === 0 ? 'bad' : (staleBrowsers === extCount ? 'bad' : 'ok'));
  setArrow(2, liveBrowsers > 0 ? 'ok' : null);

  // Banner: surface common problems
  let banner = null;
  // Detect SW wedging from recent activity: a browser that's connected
  // (status green) but whose recent tool calls all timed out. Most common
  // cause is MV3 service worker suspension during a tool call.
  const recent = s.recentRequests || [];
  const timedOutByBrowser = {};
  recent.slice(-15).forEach(r => {
    if (r.status === 'timeout' && r.browserId && r.browserId !== 'all-browsers') {
      timedOutByBrowser[r.browserId] = (timedOutByBrowser[r.browserId] || 0) + 1;
    }
  });
  const wedgedBrowsers = Object.entries(timedOutByBrowser).filter(([, n]) => n >= 2);

  if (extCount === 0 && s.recentRejections.length > 0) {
    banner = 'Your browser extension is trying to connect but the bridge is rejecting it. The extension ID isn\\'t allowlisted. Run <code>npx agenthub-setup --extension-id &lt;your-id&gt;</code>.';
  } else if (extCount === 0) {
    banner = 'No browser extension connected. Open the AgentHub side panel in Chrome or Edge.';
  } else if (wedgedBrowsers.length > 0) {
    // Recent tool calls keep timing out against this browser even though
    // its WS is connected. Strong signal of a wedged MV3 service worker.
    const list = wedgedBrowsers.map(([id, n]) => esc(id.split(':')[0]) + ' (' + n + ' recent timeouts)').join(', ');
    banner = '\u26A0\uFE0F <b>Service worker may be stuck</b> in: <b>' + list + '</b>. Recent tool calls timed out even though the connection looks fine. Try the per-browser <b>"Reload this browser"</b> button in the Connected Browsers card below to wake it up.';
  } else if (mcpCount === 0) {
    banner = 'No AI assistant has connected yet. The bridge and extension are ready when you are.';
  }
  if (banner) {
    document.getElementById('banner').style.display = 'block';
    document.getElementById('bannerMsg').innerHTML = banner;
  } else {
    document.getElementById('banner').style.display = 'none';
  }

  // Activity timeline
  renderActivity(s.recentRequests || []);

  // Restore any item-detail panels the user had opened before the poll.
  reapplyOpenItems();
}

// \u2500\u2500 Friendly name resolution for MCP clients \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function mcpClientFriendlyName(c) {
  if (c.clientInfo && c.clientInfo.name) {
    return c.clientInfo.name + (c.clientInfo.version ? ' v' + c.clientInfo.version : '');
  }
  // stdio: the MCP-over-stdio attached client (likely the bridge's own
  // stdio if launched from a config); show transport prominently
  if (c.transport === 'stdio') return 'Stdio MCP client';
  // ws: a Node MCP child (like the VS Code helper); show short id
  return 'MCP client ' + (c.clientId || '').slice(0, 8) + '\u2026';
}
function mcpClientEmoji(c) {
  const name = ((c.clientInfo && c.clientInfo.name) || '').toLowerCase();
  if (name.includes('claude')) return '\u{1F916}';
  if (name.includes('cursor')) return '\u{1F7E0}';
  if (name.includes('vscode') || name.includes('vs code') || name.includes('copilot')) return '\u{1F7E6}';
  if (name.includes('zed')) return '\u26A1';
  return c.transport === 'stdio' ? '\u2328\uFE0F' : '\u{1F50C}';
}
function browserBrandEmoji(brand) {
  if (brand === 'chrome') return '\u{1F7E2}';
  if (brand === 'edge') return '\u{1F537}';
  if (brand === 'brave') return '\u{1F981}';
  if (brand === 'arc') return '\u{1F308}';
  if (brand === 'vivaldi') return '\u{1F7E5}';
  return '\u{1F310}';
}

function renderClientItem(c, i, requests) {
  const friendly = mcpClientFriendlyName(c);
  const emoji = mcpClientEmoji(c);
  const recentForThis = requests.filter(r => r.clientId === c.clientId).slice(-3).reverse();
  const detailHtml =
    '<div class="row"><span class="label">Type</span><span class="val">' + esc(c.transport) + (c.clientInfo ? ' \u2022 ' + esc(c.clientInfo.name) + ' v' + esc(c.clientInfo.version) : '') + '</span></div>' +
    '<div class="row"><span class="label">Client ID</span><span class="val">' + esc(c.clientId) + '</span></div>' +
    '<div class="row"><span class="label">Connected</span><span class="val">' + fmtRelTime(c.connectedAt) + ' (' + esc(c.connectedAt) + ')</span></div>' +
    '<div class="row"><span class="label">Tool calls</span><span class="val">' + c.recentRequestCount + ' in last 50</span></div>' +
    (recentForThis.length > 0 ? '<div class="recent-mini"><div class="mini-title">Recent activity</div>' +
      recentForThis.map(r => {
        const e = r.status === 'success' ? '\u2705' : r.status === 'error' ? '\u274C' : r.status === 'pending' ? '\u23F3' : '\u26A0\uFE0F';
        return '<div class="mini-row"><span class="mini-emoji">' + e + '</span>' + esc(r.tool) + ' \u2192 ' + esc(r.browserId.split(':')[0]) + ' (' + (r.durationMs != null ? r.durationMs + 'ms' : 'pending') + ')</div>';
      }).join('') + '</div>' : '');
  return '<button class="item" data-kind="mcp" data-idx="' + i + '" onclick="toggleItem(this)" aria-expanded="false">' +
    '<span class="item-emoji">' + emoji + '</span>' +
    '<span class="item-main"><b>' + esc(friendly) + '</b>' +
    '<span class="item-sub">' + esc(c.transport) + ' \u2022 ' + fmtRelTime(c.connectedAt) + '</span></span>' +
    '<span class="item-count">' + c.recentRequestCount + ' call' + (c.recentRequestCount === 1 ? '' : 's') + '</span>' +
    '<span class="item-caret">\u25B8</span>' +
    '</button>' +
    '<div class="item-detail" data-detail-for="mcp-' + i + '" style="display:none">' + detailHtml + '</div>';
}

function renderBrowserItem(b, i, requests) {
  const brand = b.browserId.split(':')[0] || 'browser';
  const id = b.browserId.split(':')[1] || '';
  const emoji = browserBrandEmoji(brand);
  const recentForThis = requests.filter(r => r.browserId === b.browserId).slice(-3).reverse();
  // Liveness badge \u2014 STALE means OS-level WS is open but extension's SW
  // hasn't sent us anything in 45+ seconds (almost certainly wedged).
  const livenessLabel = b.liveness === 'live'
    ? '<span style="color:#16a34a">\u25CF</span> alive (heard ' + (b.lastSeenAgeSec ?? '?') + 's ago)'
    : b.liveness === 'stale'
      ? '<span style="color:#dc2626">\u25CF</span> STUCK (no answer for ' + (b.lastSeenAgeSec ?? '?') + 's)'
      : '<span style="color:#94a3b8">\u25CF</span> waiting for first message';
  // Per-browser reload button. Sends {type:'reload'} ONLY to this browser's
  // WS \u2014 doesn't reload Chrome when you only wanted to reload Edge.
  // Escape browserId for JS string literal embedding.
  const browserIdJs = b.browserId.replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'");
  const detailHtml =
    '<div class="row"><span class="label">Brand</span><span class="val">' + esc(brand) + '</span></div>' +
    '<div class="row"><span class="label">Browser ID</span><span class="val">' + esc(b.browserId) + '</span></div>' +
    '<div class="row"><span class="label">Connected</span><span class="val">' + fmtRelTime(b.connectedAt) + ' (' + esc(b.connectedAt) + ')</span></div>' +
    '<div class="row"><span class="label">Liveness</span><span class="val">' + livenessLabel + '</span></div>' +
    '<div class="row"><span class="label">Tool calls</span><span class="val">' + b.recentRequestCount + ' in last 50</span></div>' +
    (recentForThis.length > 0 ? '<div class="recent-mini"><div class="mini-title">Recent activity</div>' +
      recentForThis.map(r => {
        const e = r.status === 'success' ? '\u2705' : r.status === 'error' ? '\u274C' : r.status === 'pending' ? '\u23F3' : '\u26A0\uFE0F';
        return '<div class="mini-row"><span class="mini-emoji">' + e + '</span>' + esc(r.tool) + ' (' + (r.durationMs != null ? r.durationMs + 'ms' : 'pending') + ')</div>';
      }).join('') + '</div>' : '') +
    '<div style="margin-top:10px; padding-top:8px; border-top:1px dashed #cbd5e1; display:flex; gap:6px;">' +
      '<button class="btn" onclick="reloadOneBrowser(\\'' + browserIdJs + '\\')" title="Reload AgentHub extension only in this browser">Reload this browser</button>' +
    '</div>';
  // Per-row class for status hint \u2014 orange border on stale rows.
  const itemExtraClass = b.liveness === 'stale' ? ' item-stale' : '';
  return '<button class="item' + itemExtraClass + '" data-kind="browser" data-idx="' + i + '" onclick="toggleItem(this)" aria-expanded="false">' +
    '<span class="item-emoji">' + emoji + '</span>' +
    '<span class="item-main"><b>' + esc(brand) + (b.liveness === 'stale' ? ' <span style="color:#dc2626;font-weight:700">\u26A0 STUCK</span>' : '') + '</b>' +
    '<span class="item-sub">' + esc(id.slice(0, 12)) + '\u2026 \u2022 ' + fmtRelTime(b.connectedAt) + '</span></span>' +
    '<span class="item-count">' + b.recentRequestCount + ' call' + (b.recentRequestCount === 1 ? '' : 's') + '</span>' +
    '<span class="item-caret">\u25B8</span>' +
    '</button>' +
    '<div class="item-detail" data-detail-for="browser-' + i + '" style="display:none">' + detailHtml + '</div>';
}

// Toggles an expandable detail panel beneath a list item. Persists open state
// across polls via the data-kind/data-idx pair stored in state.openItems.
function toggleItem(button) {
  const kind = button.dataset.kind;
  const idx = button.dataset.idx;
  const key = kind + '-' + idx;
  const detail = button.parentElement.querySelector('[data-detail-for="' + key + '"]');
  if (!detail) return;
  const willOpen = detail.style.display === 'none';
  detail.style.display = willOpen ? 'block' : 'none';
  button.classList.toggle('expanded', willOpen);
  button.setAttribute('aria-expanded', String(willOpen));
  if (willOpen) state.openItems.add(key);
  else state.openItems.delete(key);
}

// Scrolls to + briefly highlights the Connected Browsers card, then
// expands every browser of the given brand. Called from the brand chips
// in the Extension card (e.g. clicking the "\u{1F7E2} chrome \xD72" chip).
function scrollToBrowser(brand) {
  const card = document.getElementById('card-browser');
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  // Pulse highlight so user sees what was targeted
  card.classList.remove('highlight');
  void card.offsetWidth; // force reflow so re-adding the class restarts the animation
  card.classList.add('highlight');
  setTimeout(() => card.classList.remove('highlight'), 1300);
  // Expand all browser items whose brand matches
  if (state.state && state.state.browsers) {
    state.state.browsers.forEach((b, i) => {
      if ((b.browserId.split(':')[0] || '') === brand) {
        state.openItems.add('browser-' + i);
      }
    });
    reapplyOpenItems();
  }
}
// Re-apply the "open" state after each render so user's clicks survive
// the 1.5s polling refresh.
function reapplyOpenItems() {
  for (const key of state.openItems) {
    const btn = document.querySelector('.item[data-kind="' + key.split('-')[0] + '"][data-idx="' + key.split('-')[1] + '"]');
    if (btn) {
      const detail = btn.parentElement.querySelector('[data-detail-for="' + key + '"]');
      if (detail) {
        detail.style.display = 'block';
        btn.classList.add('expanded');
        btn.setAttribute('aria-expanded', 'true');
      }
    }
  }
}

function renderActivity(reqs) {
  const list = document.getElementById('activity-list');
  document.getElementById('activity-count').textContent = reqs.length + ' action' + (reqs.length === 1 ? '' : 's');
  if (reqs.length === 0) {
    list.innerHTML = '<div class="activity-empty">No activity yet. Try asking your AI assistant to do something.</div>';
    return;
  }
  list.innerHTML = reqs.slice().reverse().map(r => {
    const emoji = r.status === 'success' ? '\u2705' : r.status === 'error' ? '\u274C' : r.status === 'pending' ? '\u23F3' : r.status === 'timeout' ? '\u23F1\uFE0F' : '\u26A0\uFE0F';
    const cls = r.status;
    const browser = r.browserId ? r.browserId.split(':')[0] : 'all';
    // Each row is clickable \u2014 opens a drill-down modal showing the full
    // step-by-step chain (received \u2192 liveness probe \u2192 tool sent \u2192 reply).
    return '<div class="activity-row ' + cls + '" onclick="openCallDetail(\\'' + esc(r.browserBoundId) + '\\')" title="Click for full details" role="button" tabindex="0">' +
      '<span class="activity-time">' + fmtRelTime(r.startedAt) + '</span>' +
      '<span class="activity-emoji">' + emoji + '</span>' +
      '<span class="activity-desc"><b>' + esc(r.tool) + '</b></span>' +
      '<span class="activity-target">' + esc(browser) + '</span>' +
      '<span class="activity-dur">' + (r.durationMs != null ? r.durationMs + 'ms' : '\u2014') + '</span>' +
      '</div>';
  }).join('');
}

// \u2500\u2500 Drill-down modal \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
async function openCallDetail(browserBoundId) {
  try {
    const r = await fetch('/api/request/' + encodeURIComponent(browserBoundId));
    if (!r.ok) {
      toast('Could not load request details (status ' + r.status + ')', true);
      return;
    }
    const { request } = await r.json();
    renderCallDetail(request);
    document.getElementById('modalOverlay').classList.add('open');
  } catch (err) {
    toast('Failed to load: ' + err.message, true);
  }
}

function closeModal(evt) {
  // Close only on backdrop click \u2014 not clicks inside the modal body
  if (evt && evt.target !== document.getElementById('modalOverlay')) return;
  document.getElementById('modalOverlay').classList.remove('open');
}

function renderCallDetail(req) {
  const emoji = req.status === 'success' ? '\u2705' : req.status === 'error' ? '\u274C' : req.status === 'pending' ? '\u23F3' : req.status === 'timeout' ? '\u23F1\uFE0F' : '\u26A0\uFE0F';
  const brand = req.browserId.split(':')[0] || 'browser';
  document.getElementById('modalTitle').innerHTML = emoji + ' <b>' + esc(req.tool) + '</b> \u2192 ' + esc(brand);
  document.getElementById('modalSubtitle').textContent =
    'Started ' + fmtRelTime(req.startedAt) +
    (req.durationMs != null ? ' \xB7 took ' + req.durationMs + 'ms' : ' \xB7 still running');

  // Summary panel
  const summary = document.getElementById('modalSummary');
  summary.innerHTML =
    '<span class="lbl">Asked by</span><span class="val">' + esc(req.clientId) + '</span>' +
    '<span class="lbl">Tool</span><span class="val">' + esc(req.tool) + '</span>' +
    '<span class="lbl">Browser</span><span class="val">' + esc(req.browserId) + '</span>' +
    '<span class="lbl">Status</span><span class="val">' + esc(req.status) + (req.errorMessage ? ' (' + esc(req.errorMessage) + ')' : '') + '</span>' +
    '<span class="lbl">Request ID</span><span class="val">' + esc(req.browserBoundId) + '</span>';

  // Step timeline
  const stepsEl = document.getElementById('modalSteps');
  if (!req.steps || req.steps.length === 0) {
    stepsEl.innerHTML = '<div class="activity-empty">No step trace recorded. (Old request? Restart bridge for new requests to be traced.)</div>';
    return;
  }
  stepsEl.innerHTML = req.steps.map(step => {
    const icon = step.status === 'ok' ? '\u2713' : step.status === 'fail' ? '\u2715' : step.status === 'wait' ? '\u231B' : '\u2139';
    const time = step.t.split('T')[1].slice(0, 12);
    return '<div class="step ' + esc(step.status) + '">' +
      '<div class="step-icon">' + icon + '</div>' +
      '<div class="step-time">' + esc(time) + '</div>' +
      '<div class="step-body">' +
        '<div class="step-msg">' + esc(step.message) + '</div>' +
        (step.cause ? '<div class="step-cause">\u{1F4A1} ' + esc(step.cause) + '</div>' : '') +
      '</div>' +
    '</div>';
  }).join('');
}

// Allow Esc to close the modal too \u2014 accessibility nicety
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

// \u2500\u2500 Logs \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
async function loadLogs() {
  for (const f of ['bridge', 'extension', 'helper']) {
    try {
      const r = await fetch('/api/logs?file=' + f + '&n=200');
      const json = await r.json();
      state.logs[f] = json.lines || [];
      document.getElementById('count-' + f).textContent = state.logs[f].length;
    } catch (err) {
      state.logs[f] = [];
    }
  }
  renderLogs();
}

function switchTab(tab) {
  state.currentTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  renderLogs();
}

function renderLogs() {
  const view = document.getElementById('logs-view');
  const search = document.getElementById('logs-search').value.toLowerCase();
  const lines = state.logs[state.currentTab] || [];
  const filtered = search ? lines.filter(l => l.toLowerCase().includes(search)) : lines;
  if (filtered.length === 0) {
    view.innerHTML = '<div class="logs-empty">' + (search ? 'No matches for "' + esc(search) + '"' : 'No log entries yet') + '</div>';
    return;
  }
  view.innerHTML = filtered.map(line => {
    try {
      const j = JSON.parse(line);
      return '<div><span class="t">' + esc(j.t || '') + '</span> ' +
             '<span class="lvl-' + esc(j.lvl) + '">[' + esc(j.lvl) + ']</span> ' +
             '<span class="ev">' + esc(j.event) + '</span> ' +
             esc(JSON.stringify({...j, t: undefined, lvl: undefined, event: undefined, src: undefined}).slice(1, -1)) +
             '</div>';
    } catch {
      return '<div>' + esc(line) + '</div>';
    }
  }).join('');
  view.scrollTop = view.scrollHeight;
}

// \u2500\u2500 Actions \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
async function action(name) {
  const endpoints = {
    'restart-bridge': { url: '/api/restart', confirmMsg: 'Restart the bridge? Connected clients will reconnect automatically.' },
    'reload-extension': { url: '/api/reload-extension', confirmMsg: 'Reload AgentHub extension in ALL connected browsers? Open chats in any of them will be lost.' },
  };
  const ep = endpoints[name];
  if (!ep) return;
  if (!confirm(ep.confirmMsg)) return;
  try {
    const r = await fetch(ep.url, { method: 'POST' });
    const j = await r.json();
    toast(j.message || (r.ok ? 'Done' : 'Failed'), !r.ok);
    setTimeout(poll, 1500);
  } catch (err) {
    toast('Request failed: ' + err.message, true);
  }
}

// Targeted reload for a single browser. Sends the {type:'reload'} signal
// ONLY to that browser's WebSocket. Other connected browsers are unaffected
// (no extension reload, no SW death, no side panel loss).
async function reloadOneBrowser(browserId) {
  if (!confirm('Reload AgentHub extension in ' + browserId.split(':')[0] + '?\\nThis browser will reload its extension (open chats there will be lost). Other browsers are NOT affected.')) return;
  try {
    const url = '/api/reload-extension?browserId=' + encodeURIComponent(browserId);
    const r = await fetch(url, { method: 'POST' });
    const j = await r.json();
    toast(j.message || (r.ok ? 'Done' : 'Failed'), !r.ok);
    setTimeout(poll, 1500);
  } catch (err) {
    toast('Request failed: ' + err.message, true);
  }
}

// \u2500\u2500 Init \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
poll();
loadLogs();
setInterval(poll, POLL_MS);
setInterval(loadLogs, 5000); // logs refresh every 5s
</script>
</body>
</html>
`;

// src/diag-server.ts
var RecentActivity = class {
  buf = [];
  rejections = /* @__PURE__ */ new Map();
  MAX = 50;
  startRequest(input, initialStep) {
    const startedAt = (/* @__PURE__ */ new Date()).toISOString();
    const steps = [];
    if (initialStep) {
      steps.push({ ...initialStep, t: startedAt });
    }
    const rec = {
      ...input,
      status: "pending",
      startedAt,
      finishedAt: null,
      durationMs: null,
      steps
    };
    this.buf.push(rec);
    while (this.buf.length > this.MAX) this.buf.shift();
  }
  /**
   * Append a single step to a tracked request. No-op if the request is
   * not in the buffer (already evicted, never started, etc).
   */
  addStep(browserBoundId, step) {
    const rec = this.buf.find((r) => r.browserBoundId === browserBoundId);
    if (!rec) return;
    rec.steps.push({ ...step, t: (/* @__PURE__ */ new Date()).toISOString() });
  }
  finishRequest(browserBoundId, status, errorMessage, finalStep) {
    const rec = this.buf.find((r) => r.browserBoundId === browserBoundId);
    if (!rec) return;
    rec.status = status;
    rec.finishedAt = (/* @__PURE__ */ new Date()).toISOString();
    rec.durationMs = Date.parse(rec.finishedAt) - Date.parse(rec.startedAt);
    if (errorMessage) rec.errorMessage = errorMessage;
    if (finalStep) {
      const stepStatus = status === "success" ? "ok" : "fail";
      rec.steps.push({ ...finalStep, status: stepStatus, t: rec.finishedAt });
    }
  }
  /** Look up a single request by its browserBoundId. Used by /api/request/<id>. */
  getRequest(browserBoundId) {
    return this.buf.find((r) => r.browserBoundId === browserBoundId);
  }
  noteRejection(origin, reason) {
    const key = origin + "|" + reason;
    const existing = this.rejections.get(key);
    if (existing) {
      existing.count++;
      existing.lastSeenAt = (/* @__PURE__ */ new Date()).toISOString();
    } else {
      this.rejections.set(key, { origin, reason, lastSeenAt: (/* @__PURE__ */ new Date()).toISOString(), count: 1 });
    }
  }
  snapshot() {
    return {
      requests: this.buf.slice(),
      // Most recent first, cap at 10 entries
      rejections: Array.from(this.rejections.values()).sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt)).slice(0, 10)
    };
  }
};
var LOCALHOST_ADDRS = /* @__PURE__ */ new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
function isLocalhost(req) {
  const addr = req.socket.remoteAddress ?? "";
  return LOCALHOST_ADDRS.has(addr);
}
function corsHeadersFor(origin) {
  if (!origin) return {};
  if (origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://")) {
    return {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "content-type",
      // Cache preflight for 5 min so the SW doesn't roundtrip OPTIONS every poll.
      "access-control-max-age": "300",
      // Echo origin in Vary so caching layers don't cross-pollute.
      "vary": "origin"
    };
  }
  return {};
}
function respondJson(res, code, body, cors = {}) {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
    // Prevent the diag UI from being framed by a malicious page in a browser
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    ...cors
  });
  res.end(text);
}
function respondHtml(res, body) {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-cache, no-store",
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:"
  });
  res.end(body);
}
function tailLines(filePath, n) {
  if (!(0, import_node_fs4.existsSync)(filePath)) return [];
  try {
    const sz = (0, import_node_fs4.statSync)(filePath).size;
    if (sz === 0) return [];
    const raw = (0, import_node_fs4.readFileSync)(filePath, "utf-8");
    const lines = raw.split("\n").filter((l) => l.length > 0);
    return lines.slice(-n);
  } catch {
    return [];
  }
}
function handleDiagRequest(req, res, hooks) {
  if (!isLocalhost(req)) {
    respondJson(res, 403, { ok: false, message: "localhost only" });
    return true;
  }
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
  const path = url.pathname;
  const method = req.method ?? "GET";
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : void 0;
  const corsForReads = corsHeadersFor(origin);
  if (method === "OPTIONS" && path.startsWith("/api/")) {
    res.writeHead(204, { ...corsForReads });
    res.end();
    return true;
  }
  if (method === "GET" && (path === "/" || path === "/index.html")) {
    respondHtml(res, DIAG_HTML);
    return true;
  }
  if (method === "GET" && path === "/api/state") {
    const s = hooks.getState();
    const { requests, rejections } = s.recentActivity.snapshot();
    respondJson(res, 200, {
      bridge: s.bridge,
      browsers: s.browsers,
      mcpClients: s.mcpClients,
      recentRequests: requests,
      recentRejections: rejections
    }, corsForReads);
    return true;
  }
  if (method === "GET" && path.startsWith("/api/request/")) {
    const id = decodeURIComponent(path.slice("/api/request/".length));
    const req2 = hooks.getState().recentActivity.getRequest(id);
    if (!req2) {
      respondJson(res, 404, { ok: false, message: "request not found (may have been evicted from the 50-entry ring buffer)" }, corsForReads);
      return true;
    }
    respondJson(res, 200, { request: req2 }, corsForReads);
    return true;
  }
  if (method === "GET" && path === "/api/logs") {
    const file = url.searchParams.get("file");
    const n = Math.min(1e3, parseInt(url.searchParams.get("n") ?? "200", 10) || 200);
    const paths = hooks.logPaths();
    let p = null;
    if (file === "bridge") p = paths.bridge;
    else if (file === "extension") p = paths.extension;
    else if (file === "helper") p = paths.helper;
    if (!p) {
      respondJson(res, 400, { ok: false, message: "file must be one of: bridge, extension, helper" }, corsForReads);
      return true;
    }
    respondJson(res, 200, { lines: tailLines(p, n) }, corsForReads);
    return true;
  }
  if (method === "POST" && path === "/api/restart") {
    respondJson(res, 200, { ok: true, message: "Restarting bridge\u2026" });
    setTimeout(() => hooks.onRestartRequest(), 250);
    return true;
  }
  if (method === "POST" && path === "/api/reload-extension") {
    const targetBrowserId = url.searchParams.get("browserId") ?? void 0;
    const result = hooks.onReloadExtensionRequest(targetBrowserId);
    let msg;
    if (result.broadcastTo === 0) {
      msg = targetBrowserId ? `No extension connected for ${targetBrowserId} \u2014 nothing to reload` : "No extensions connected \u2014 nothing to reload";
    } else if (targetBrowserId) {
      msg = `Reload signal sent to ${targetBrowserId}`;
    } else {
      msg = `Reload signal sent to ${result.broadcastTo} extension${result.broadcastTo === 1 ? "" : "s"}`;
    }
    respondJson(res, 200, { ok: true, message: msg });
    return true;
  }
  if (path.startsWith("/api/")) {
    respondJson(res, 404, { ok: false, message: "unknown endpoint" }, corsForReads);
    return true;
  }
  return false;
}

// src/service.ts
var REQUEST_TIMEOUT_MS = 3e4;
var recentActivity = new RecentActivity();
var mcpClientRegistry = /* @__PURE__ */ new Map();
var browserRegistry = /* @__PURE__ */ new Map();
var browserSockets = /* @__PURE__ */ new Map();
var brandIndex = /* @__PURE__ */ new Map();
function parseBrand(browserId) {
  const colon = browserId.indexOf(":");
  return colon === -1 ? browserId : browserId.slice(0, colon);
}
function extractBrowserIdFromTabId(input) {
  if (typeof input !== "string") return "";
  const s = input.trim();
  if (!s || /^[0-9]+$/.test(s)) return "";
  const lastColon = s.lastIndexOf(":");
  if (lastColon <= 0 || lastColon === s.length - 1) return "";
  const rawSuffix = s.slice(lastColon + 1);
  if (!/^[0-9]+$/.test(rawSuffix)) return "";
  return s.slice(0, lastColon);
}
var EXTENSION_SCHEMES = ["chrome-extension://", "moz-extension://", "safari-web-extension://"];
function extensionIdFromOrigin(origin) {
  for (const scheme of EXTENSION_SCHEMES) {
    if (origin.startsWith(scheme)) {
      const rest = origin.slice(scheme.length);
      const slash = rest.indexOf("/");
      return slash === -1 ? rest : rest.slice(0, slash);
    }
  }
  return "";
}
function isAllowedOrigin(origin, allowedExtensionIds) {
  if (!origin) return true;
  const id = extensionIdFromOrigin(origin);
  if (!id) return false;
  if (!allowedExtensionIds || allowedExtensionIds.size === 0) return true;
  return allowedExtensionIds.has(id);
}
function loadAllowedExtensionIds(opts) {
  const env = opts?.env ?? process.env;
  const result = /* @__PURE__ */ new Set();
  const envValue = env.AGENTHUB_ALLOWED_EXTENSION_IDS;
  if (envValue) {
    for (const raw of envValue.split(",")) {
      const id = raw.trim();
      if (id) result.add(id);
    }
  }
  if (result.size > 0) return result;
  const installDir = opts?.installDir ?? defaultInstallDir();
  if (!installDir) return result;
  try {
    const configPath = (0, import_node_path4.join)(installDir, "extension-ids.json");
    if (!(0, import_node_fs5.existsSync)(configPath)) return result;
    const parsed = JSON.parse((0, import_node_fs5.readFileSync)(configPath, "utf-8"));
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (typeof entry === "string" && entry.trim()) result.add(entry.trim());
      }
    }
  } catch {
  }
  return result;
}
function defaultInstallDir() {
  switch ((0, import_node_os2.platform)()) {
    case "win32":
      return (0, import_node_path4.join)(process.env.LOCALAPPDATA ?? (0, import_node_path4.join)((0, import_node_os2.homedir)(), "AppData", "Local"), "agenthub");
    case "darwin":
      return (0, import_node_path4.join)((0, import_node_os2.homedir)(), "Library", "Application Support", "agenthub");
    default:
      return (0, import_node_path4.join)((0, import_node_os2.homedir)(), ".local", "share", "agenthub");
  }
}
function indexBrowser(browserId, ws) {
  const existing = browserSockets.get(browserId);
  if (existing && existing !== ws) {
    bridgeLog().warn("bridge.browser.replaced", {
      browserId,
      reason: "new_socket_for_same_browserid",
      hint: "Old socket was orphaned (likely Chrome MV3 SW eviction). Terminating it now."
    });
    try {
      existing.terminate();
    } catch {
    }
    for (const [reqId, req] of pendingRequests) {
      if (req.browserId === browserId) {
        clearTimeout(req.timer);
        pendingRequests.delete(reqId);
        try {
          req.reject(new Error("browser_socket_replaced_mid_request"));
        } catch {
        }
      }
    }
  }
  browserSockets.set(browserId, ws);
  const brand = parseBrand(browserId);
  let set = brandIndex.get(brand);
  if (!set) {
    set = /* @__PURE__ */ new Set();
    brandIndex.set(brand, set);
  }
  set.add(browserId);
}
function unindexBrowser(browserId) {
  browserSockets.delete(browserId);
  const brand = parseBrand(browserId);
  const set = brandIndex.get(brand);
  if (set) {
    set.delete(browserId);
    if (set.size === 0) brandIndex.delete(brand);
  }
  lastBrowserDisconnectedAt = Date.now();
}
var lastBrowserDisconnectedAt = 0;
var SW_RECONNECT_GRACE_MS = 4e3;
var SW_RECONNECT_POLL_INTERVAL_MS = 200;
var mcpClients = /* @__PURE__ */ new Map();
var pendingRequests = /* @__PURE__ */ new Map();
var startTime = Date.now();
var serverPort = 0;
function getServerInfo() {
  return {
    type: "server_info",
    pid: process.pid,
    port: serverPort,
    version: VERSION,
    buildId: BUILD_ID,
    startedBy: process.env.AI_BROWSER_COPILOT_STARTED_BY ?? "service",
    capabilities: toolRegistry.map((t) => t.name),
    uptime: Math.floor((Date.now() - startTime) / 1e3),
    connectedBrowsers: Array.from(browserSockets.keys()),
    connectedStubs: mcpClients.size + 1
  };
}
function parseQuery(url) {
  if (!url) return new URLSearchParams();
  const qi = url.indexOf("?");
  return qi === -1 ? new URLSearchParams() : new URLSearchParams(url.slice(qi + 1));
}
var SERVER_PING_INTERVAL_MS = 2e4;
var HELPER_PROBE_BROWSER_ID = "helper-probe";
var browserLastSeen = /* @__PURE__ */ new Map();
var pendingPongs = /* @__PURE__ */ new Map();
function markBrowserAlive(browserId) {
  browserLastSeen.set(browserId, Date.now());
}
function proveLive(browserId, ws, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const handler = (_timestamp) => {
      if (settled) return;
      settled = true;
      resolve(true);
    };
    const waiters = pendingPongs.get(browserId) ?? [];
    waiters.push(handler);
    pendingPongs.set(browserId, waiters);
    setTimeout(() => {
      if (settled) return;
      settled = true;
      const arr = pendingPongs.get(browserId);
      if (arr) {
        const i = arr.indexOf(handler);
        if (i >= 0) arr.splice(i, 1);
      }
      resolve(false);
    }, timeoutMs);
    try {
      if (ws.readyState === import_websocket.default.OPEN) {
        ws.send(JSON.stringify({ type: "server_ping", timestamp: Date.now(), reason: "liveness-probe" }));
      } else {
        settled = true;
        resolve(false);
      }
    } catch {
      settled = true;
      resolve(false);
    }
  });
}
var LIVENESS_PROBE_TIMEOUT_MS = 3e3;
var INCUMBENT_LIVENESS_TIMEOUT_MS = 1500;
function handleExtension(ws, browserId) {
  const connectedAt = Date.now();
  const isProbe = browserId === HELPER_PROBE_BROWSER_ID;
  const accept = () => {
    if (ws.readyState !== import_websocket.default.OPEN) {
      return;
    }
    if (isProbe) {
      bridgeLog().info("bridge.probe.connected", { browserId });
    } else {
      bridgeLog().info("bridge.browser.connected", { browserId });
      browserRegistry.set(browserId, { connectedAt: new Date(connectedAt).toISOString() });
    }
    indexBrowser(browserId, ws);
    ws.send(JSON.stringify(getServerInfo()));
    const serverPingTimer = setInterval(() => {
      if (ws.readyState === import_websocket.default.OPEN) {
        ws.send(JSON.stringify({ type: "server_ping", timestamp: Date.now() }));
      }
    }, SERVER_PING_INTERVAL_MS);
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        markBrowserAlive(browserId);
        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong", timestamp: msg.timestamp }));
          return;
        }
        if (msg.type === "server_pong") {
          const waiters = pendingPongs.get(browserId);
          if (waiters && waiters.length > 0) {
            const ts = typeof msg.timestamp === "number" ? msg.timestamp : Date.now();
            for (const w of waiters.slice()) {
              try {
                w(ts);
              } catch {
              }
            }
            pendingPongs.set(browserId, []);
          }
          return;
        }
        if (msg.type === "request_tool_scan") {
          ws.send(JSON.stringify({ type: "tool_scan", tools: [] }));
          return;
        }
        if (msg.type === "log_batch" && Array.isArray(msg.entries)) {
          const MAX_BATCH = 200;
          if (msg.entries.length > MAX_BATCH) {
            bridgeLog().warn("bridge.log_batch.oversize_dropped", {
              browserId,
              received: msg.entries.length,
              cap: MAX_BATCH
            });
            return;
          }
          for (const entry of msg.entries) {
            if (!isValidLogEntry(entry)) continue;
            logRecord({ filePath: getExtensionLogPath() }, {
              ...entry,
              _via_bridge_pid: process.pid,
              _from_browser: browserId
            });
          }
          return;
        }
        if (msg.id) {
          const pending = pendingRequests.get(msg.id);
          if (pending) {
            clearTimeout(pending.timer);
            pendingRequests.delete(msg.id);
            pending.resolve(msg);
          }
        }
      } catch {
      }
    });
    ws.on("close", () => {
      clearInterval(serverPingTimer);
      if (browserSockets.get(browserId) === ws) {
        unindexBrowser(browserId);
        browserLastSeen.delete(browserId);
        const waiters = pendingPongs.get(browserId);
        if (waiters && waiters.length > 0) {
        }
        pendingPongs.delete(browserId);
        if (!isProbe) browserRegistry.delete(browserId);
        const event = isProbe ? "bridge.probe.disconnected" : "bridge.browser.disconnected";
        let pendingForThisBrowser = 0;
        for (const req of pendingRequests.values()) {
          if (req.browserId === browserId) pendingForThisBrowser++;
        }
        bridgeLog().info(event, {
          browserId,
          durationMs: Date.now() - connectedAt,
          pendingRequestCount: pendingForThisBrowser,
          totalPendingAcrossAllBrowsers: pendingRequests.size
        });
      }
    });
  };
  const existing = browserSockets.get(browserId);
  if (!isProbe && existing && existing !== ws && existing.readyState === import_websocket.default.OPEN) {
    proveLive(browserId, existing, INCUMBENT_LIVENESS_TIMEOUT_MS).then((alive) => {
      if (alive) {
        bridgeLog().warn("bridge.browser.duplicate_rejected", {
          browserId,
          reason: "incumbent_socket_still_live",
          hint: "A second socket arrived for a browserId whose existing socket still answers pings \u2014 keeping the live one and closing the duplicate. Common cause: a stale extension/helper health-probe that predates the helper-probe sentinel. Tool routing is preserved."
        });
        try {
          ws.close(4002, "duplicate_live_incumbent");
        } catch {
        }
        return;
      }
      accept();
    }).catch(() => accept());
    return;
  }
  accept();
}
function isValidLogEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  const e = entry;
  if (typeof e.event !== "string" || e.event.length > 200) return false;
  if (e.src !== "ext") return false;
  if (e.lvl !== "info" && e.lvl !== "warn" && e.lvl !== "error") return false;
  return true;
}
function handleMcpClient(ws) {
  const clientId = (0, import_node_crypto2.randomUUID)();
  mcpClients.set(clientId, ws);
  mcpClientRegistry.set(clientId, { transport: "ws", connectedAt: (/* @__PURE__ */ new Date()).toISOString() });
  bridgeLog().info("bridge.mcp.client_connected", { clientId, transport: "ws" });
  ws.on("message", (data) => {
    const raw = data.toString();
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed) handleMcpMessage(clientId, trimmed, (msg) => {
        if (ws.readyState === import_websocket.default.OPEN) ws.send(JSON.stringify(msg));
      });
    }
  });
  ws.on("close", () => {
    mcpClients.delete(clientId);
    mcpClientRegistry.delete(clientId);
    bridgeLog().info("bridge.mcp.client_disconnected", { clientId });
    for (const [id, p] of pendingRequests) {
      if (p.clientId === clientId) {
        clearTimeout(p.timer);
        pendingRequests.delete(id);
      }
    }
  });
}
function resolveSocket(target) {
  const exact = browserSockets.get(target);
  if (exact && exact.readyState === import_websocket.default.OPEN) return exact;
  if (!target.includes(":")) {
    const ids = brandIndex.get(target);
    if (ids) {
      for (const id of ids) {
        const s = browserSockets.get(id);
        if (s && s.readyState === import_websocket.default.OPEN) return s;
      }
    }
  }
  for (const s of browserSockets.values()) {
    if (s.readyState === import_websocket.default.OPEN) return s;
  }
  return null;
}
async function sendToolRequest(clientId, originalId, tool, params, browserId) {
  let ws = resolveSocket(browserId);
  if (!ws && lastBrowserDisconnectedAt > 0) {
    const elapsed = Date.now() - lastBrowserDisconnectedAt;
    if (elapsed < SW_RECONNECT_GRACE_MS) {
      const remaining = SW_RECONNECT_GRACE_MS - elapsed;
      const deadline = Date.now() + remaining;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, SW_RECONNECT_POLL_INTERVAL_MS));
        ws = resolveSocket(browserId);
        if (ws) break;
      }
    }
  }
  if (!ws) {
    bridgeLog().warn("bridge.route.no_browser", {
      clientId,
      mcpId: originalId,
      toolName: tool,
      requestedBrowserId: browserId,
      availableBrowsers: Array.from(browserSockets.keys())
    });
    throw new Error("No browser extension connected");
  }
  return new Promise((resolve, reject) => {
    const browserBoundId = `b_${(0, import_node_crypto2.randomUUID)()}`;
    const sentAt = Date.now();
    bridgeLog().info("bridge.tool_request.sent", {
      mcpId: originalId,
      clientId,
      browserBoundId,
      browserId,
      toolName: tool,
      args: redact(params)
    });
    recentActivity.startRequest({
      mcpId: originalId,
      clientId,
      browserBoundId,
      browserId,
      tool
    });
    const timer2 = setTimeout(() => {
      pendingRequests.delete(browserBoundId);
      bridgeLog().warn("bridge.tool_request.timed_out", {
        mcpId: originalId,
        clientId,
        browserBoundId,
        browserId,
        toolName: tool,
        elapsedMs: Date.now() - sentAt
      });
      recentActivity.finishRequest(browserBoundId, "timeout", "timed out");
      reject(new Error("Tool request timed out"));
    }, REQUEST_TIMEOUT_MS);
    pendingRequests.set(browserBoundId, {
      clientId,
      originalId,
      browserId,
      resolve: (response) => {
        const r = response;
        const isError = r?.result?.isError === true || r?.type === "tool_error";
        bridgeLog().info("bridge.tool_response.received", {
          mcpId: originalId,
          clientId,
          browserBoundId,
          browserId,
          toolName: tool,
          durationMs: Date.now() - sentAt,
          type: r?.type ?? "unknown",
          isError
        });
        recentActivity.finishRequest(browserBoundId, isError ? "error" : "success");
        resolve(response);
      },
      reject: (err) => {
        recentActivity.finishRequest(browserBoundId, "error", err.message);
        reject(err);
      },
      timer: timer2
    });
    preWakeSW(ws);
    ws.send(JSON.stringify({ type: "tool_request", id: browserBoundId, tool, params }));
  });
}
var FAN_OUT_TIMEOUT_MS = 1e4;
function preWakeSW(ws) {
  try {
    if (ws.readyState === import_websocket.default.OPEN) {
      ws.send(JSON.stringify({ type: "server_ping", timestamp: Date.now(), reason: "pre-tool-request" }));
    }
  } catch {
  }
}
function fanOutToolRequest(clientId, tool, params, brandFilter, fanoutId) {
  const targets = [];
  if (brandFilter && brandFilter !== "default") {
    for (const [id, ws] of browserSockets.entries()) {
      if (parseBrand(id) === brandFilter && ws.readyState === import_websocket.default.OPEN) {
        targets.push({ browserId: id, ws });
      }
    }
  } else {
    for (const [id, ws] of browserSockets.entries()) {
      if (ws.readyState === import_websocket.default.OPEN) targets.push({ browserId: id, ws });
    }
  }
  if (targets.length === 0) {
    return Promise.resolve([]);
  }
  return Promise.all(
    targets.map(({ browserId, ws }) => (async () => {
      const browserBoundId = `b_${(0, import_node_crypto2.randomUUID)()}`;
      const sentAt = Date.now();
      const brand = browserId.split(":")[0] || "browser";
      if (fanoutId) {
        recentActivity.startRequest({
          mcpId: null,
          clientId,
          browserBoundId,
          browserId,
          tool
        }, {
          key: "tool_request_started",
          status: "info",
          message: `Bridge picked ${brand} to run ${tool}.`
        });
      }
      if (fanoutId) {
        recentActivity.addStep(browserBoundId, {
          key: "liveness_probe_sent",
          status: "wait",
          message: `Bridge knocked on ${brand}'s door (sent a tiny ping) to check it is awake.`
        });
      }
      const alive = await proveLive(browserId, ws, LIVENESS_PROBE_TIMEOUT_MS);
      if (!alive) {
        if (fanoutId) {
          bridgeLog().warn("bridge.fanout.target_unresponsive", {
            fanoutId,
            browserId,
            browserBoundId,
            elapsedMs: Date.now() - sentAt,
            reason: "no_pong_within_3s"
          });
          recentActivity.finishRequest(browserBoundId, "timeout", "sw_wedged_no_pong", {
            key: "liveness_probe_failed",
            message: `${brand} did not answer the ping in 3 seconds.`,
            cause: `${brand}'s extension brain (service worker) is asleep or stuck. Click "Reload this browser" on the Connected Browsers card to wake it up.`
          });
        }
        try {
          ws.close(1011, "sw_wedged_no_pong");
        } catch {
        }
        return { browserId, ok: false, error: "sw_wedged (no pong within 3s)" };
      }
      if (fanoutId) {
        recentActivity.addStep(browserBoundId, {
          key: "liveness_probe_ok",
          status: "ok",
          message: `${brand} answered the ping \u2014 it is awake.`
        });
      }
      return new Promise((resolve) => {
        const timer2 = setTimeout(() => {
          pendingRequests.delete(browserBoundId);
          if (fanoutId) {
            bridgeLog().warn("bridge.fanout.target_timed_out", {
              fanoutId,
              browserId,
              browserBoundId,
              elapsedMs: Date.now() - sentAt
            });
            recentActivity.finishRequest(browserBoundId, "timeout", "tool_request_timeout", {
              key: "tool_request_timed_out",
              message: `${brand} answered the ping but didn't reply to ${tool} within 10 seconds.`,
              cause: `Most likely the extension JS held a stale WebSocket reference (orphan socket): bridge sent the request on socket A, extension is now listening on socket B (a newer one from a reconnect). The orphan-detection sweep will close the dead socket within 15s and the extension will reconnect cleanly. If you keep seeing this, click "Reload this browser" below to force a fresh service worker.`
            });
          }
          resolve({ browserId, ok: false, error: "timeout" });
        }, FAN_OUT_TIMEOUT_MS);
        pendingRequests.set(browserBoundId, {
          clientId,
          originalId: null,
          browserId,
          resolve: (response) => {
            if (fanoutId) {
              bridgeLog().info("bridge.fanout.target_replied", {
                fanoutId,
                browserId,
                browserBoundId,
                durationMs: Date.now() - sentAt,
                ok: true
              });
              recentActivity.finishRequest(browserBoundId, "success", void 0, {
                key: "tool_response_received",
                message: `${brand} finished ${tool} in ${Date.now() - sentAt} ms. Bridge is sending the result to your AI.`
              });
            }
            resolve({ browserId, ok: true, response });
          },
          reject: (err) => {
            if (fanoutId) {
              bridgeLog().info("bridge.fanout.target_replied", {
                fanoutId,
                browserId,
                browserBoundId,
                durationMs: Date.now() - sentAt,
                ok: false,
                errorMessage: err.message
              });
              recentActivity.finishRequest(browserBoundId, "error", err.message, {
                key: "tool_request_failed",
                message: `${brand} reported an error while running ${tool}: ${err.message}`,
                cause: "The tool itself failed inside the extension. Check the extension log tab for details."
              });
            }
            resolve({ browserId, ok: false, error: err.message });
          },
          timer: timer2
        });
        if (fanoutId) {
          recentActivity.addStep(browserBoundId, {
            key: "tool_request_sent",
            status: "wait",
            message: `Bridge asked ${brand} to run ${tool} and is waiting for the answer.`
          });
        }
        ws.send(JSON.stringify({ type: "tool_request", id: browserBoundId, tool, params }));
        if (fanoutId) {
          bridgeLog().info("bridge.fanout.target_sent", { fanoutId, browserId, browserBoundId });
        }
      });
    })())
  );
}
function mergeFanOutListTabs(results) {
  const allTabs = [];
  const errors = [];
  for (const r of results) {
    if (!r.ok) {
      errors.push({ browserId: r.browserId, error: r.error });
      continue;
    }
    const resp = r.response;
    if (resp?.type === "tool_error") {
      errors.push({
        browserId: r.browserId,
        error: resp.error?.message ?? "extension tool error"
      });
      continue;
    }
    if (resp?.error) {
      errors.push({ browserId: r.browserId, error: resp.error.message ?? "rpc_error" });
      continue;
    }
    if (resp?.result?.isError) {
      const errText = resp.result.content?.[0]?.text ?? "extension reported tool error";
      errors.push({ browserId: r.browserId, error: errText });
      continue;
    }
    const text = resp?.result?.content?.[0]?.text;
    if (typeof text !== "string") {
      errors.push({ browserId: r.browserId, error: "malformed_envelope" });
      continue;
    }
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        errors.push({ browserId: r.browserId, error: "expected_array" });
        continue;
      }
      allTabs.push(...parsed);
    } catch (err) {
      errors.push({
        browserId: r.browserId,
        error: `parse_failed: ${err.message}`
      });
    }
  }
  const payload = {
    tabs: allTabs
  };
  if (errors.length > 0) payload.errors = errors;
  const allFailed = results.length > 0 && errors.length === results.length;
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    ...allFailed ? { isError: true } : {}
  };
}
function translateExtensionResponse(response) {
  const resp = response;
  if (resp?.type === "tool_error") {
    const message = resp.error?.message ?? "extension tool error";
    return { content: [{ type: "text", text: message }], isError: true };
  }
  if (resp?.error) {
    const message = resp.error.message ?? "extension rpc error";
    return { content: [{ type: "text", text: message }], isError: true };
  }
  if (resp?.result?.content) {
    return resp.result;
  }
  const serialised = JSON.stringify(response);
  const text = typeof serialised === "string" ? serialised : String(response);
  return {
    content: [{ type: "text", text }]
  };
}
function handleMcpMessage(clientId, raw, reply) {
  try {
    const msg = JSON.parse(raw);
    if (msg.method === "initialize") {
      const startedAt = Date.now();
      const clientName = msg.params?.clientInfo?.name;
      const clientVersion = msg.params?.clientInfo?.version;
      bridgeLog().info("bridge.mcp.initialize.received", {
        mcpId: msg.id ?? null,
        clientId,
        clientName,
        clientVersion,
        protocolVersion: msg.params?.protocolVersion
      });
      const existing = mcpClientRegistry.get(clientId);
      if (existing && typeof clientName === "string" && typeof clientVersion === "string") {
        mcpClientRegistry.set(clientId, {
          ...existing,
          clientInfo: {
            name: clientName.slice(0, 60),
            version: clientVersion.slice(0, 30)
          }
        });
      }
      reply({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "agenthub", version: VERSION }
        }
      });
      bridgeLog().info("bridge.mcp.initialize.replied", {
        mcpId: msg.id ?? null,
        clientId,
        durationMs: Date.now() - startedAt,
        serverVersion: VERSION
      });
      return;
    }
    if (msg.method === "notifications/initialized") {
      bridgeLog().info("bridge.mcp.notifications_initialized", { clientId });
      return;
    }
    if (msg.method === "tools/list") {
      const startedAt = Date.now();
      bridgeLog().info("bridge.mcp.tools_list.received", {
        mcpId: msg.id ?? null,
        clientId
      });
      const browserProp = { type: "string", description: "Target browser: chrome, edge, brave, arc, vivaldi (defaults to last-connected)" };
      const tools = toolRegistry.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: {
          type: "object",
          properties: {
            ...Object.fromEntries(Object.entries(t.inputSchema).map(([k, v]) => [k, zodToJsonSchema(v)])),
            browser: browserProp
          }
        }
      }));
      reply({ jsonrpc: "2.0", id: msg.id, result: { tools } });
      bridgeLog().info("bridge.mcp.tools_list.replied", {
        mcpId: msg.id ?? null,
        clientId,
        durationMs: Date.now() - startedAt,
        toolCount: tools.length
      });
      return;
    }
    if (msg.method === "tools/call") {
      const toolName = msg.params?.name;
      const toolArgs = msg.params?.arguments ?? {};
      const tabIdRoute = extractBrowserIdFromTabId(toolArgs.tab_id);
      const browserId = tabIdRoute || toolArgs.browser || "default";
      const originalId = msg.id ?? null;
      const receivedAt = Date.now();
      bridgeLog().info("bridge.mcp.tools_call.received", {
        mcpId: originalId,
        clientId,
        toolName,
        targetBrowserId: browserId,
        routeSource: tabIdRoute ? "tab_id_prefix" : toolArgs.browser ? "explicit_browser_param" : "default",
        args: redact(toolArgs)
      });
      const replyWithMetrics = (responseEnvelope) => {
        const isError = responseEnvelope?.result?.isError === true;
        const contentItems = Array.isArray(responseEnvelope?.result?.content) ? responseEnvelope.result.content.length : 0;
        bridgeLog().info("bridge.mcp.tools_call.replied", {
          mcpId: originalId,
          clientId,
          toolName,
          durationMs: Date.now() - receivedAt,
          isError,
          contentItems
        });
        reply(responseEnvelope);
      };
      if (toolName === "list_tabs") {
        const brandFilter = browserId === "default" ? null : browserId;
        const fanoutId = `fo_${(0, import_node_crypto2.randomUUID)()}`;
        bridgeLog().info("bridge.fanout.started", { fanoutId, mcpId: originalId, toolName, brandFilter });
        fanOutToolRequest(clientId, toolName, toolArgs, brandFilter, fanoutId).then((results) => {
          const succeeded = results.filter((r) => r.ok).length;
          const errored = results.filter((r) => !r.ok).length;
          bridgeLog().info("bridge.fanout.aggregated", {
            fanoutId,
            mcpId: originalId,
            totalTargets: results.length,
            succeeded,
            errored
          });
          if (results.length === 0) {
            replyWithMetrics({
              jsonrpc: "2.0",
              id: msg.id,
              result: { content: [{ type: "text", text: "No browser extension connected" }], isError: true }
            });
            return;
          }
          replyWithMetrics({ jsonrpc: "2.0", id: msg.id, result: mergeFanOutListTabs(results) });
        }).catch((err) => {
          bridgeLog().error("bridge.fanout.failed", {
            fanoutId,
            mcpId: originalId,
            ...redactError(err)
          });
          replyWithMetrics({
            jsonrpc: "2.0",
            id: msg.id,
            result: { content: [{ type: "text", text: `list_tabs fan-out failed: ${err.message}` }], isError: true }
          });
        });
        return;
      }
      sendToolRequest(clientId, originalId, toolName, toolArgs, browserId).then((response) => {
        replyWithMetrics({ jsonrpc: "2.0", id: msg.id, result: translateExtensionResponse(response) });
      }).catch((err) => {
        bridgeLog().warn("bridge.tool_request.failed", {
          mcpId: originalId,
          clientId,
          toolName,
          ...redactError(err)
        });
        replyWithMetrics({
          jsonrpc: "2.0",
          id: msg.id,
          result: { content: [{ type: "text", text: `Tool execution failed: ${err.message}` }], isError: true }
        });
      });
      return;
    }
    reply({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
  } catch {
  }
}
function zodToJsonSchema(z) {
  const d = z?._def;
  if (!d) return {};
  const base = {};
  if (d.description) base.description = d.description;
  switch (d.typeName) {
    case "ZodString":
      return { ...base, type: "string" };
    case "ZodNumber":
      return { ...base, type: "number" };
    case "ZodBoolean":
      return { ...base, type: "boolean" };
    case "ZodOptional":
      return zodToJsonSchema(d.innerType);
    case "ZodDefault":
      return { ...zodToJsonSchema(d.innerType), default: d.defaultValue };
    case "ZodEnum":
      return { ...base, type: "string", enum: d.options };
    case "ZodArray":
      return { ...base, type: "array", items: zodToJsonSchema(d.innerType) };
    default:
      return base;
  }
}
function getInstallDir() {
  switch ((0, import_node_os2.platform)()) {
    case "win32":
      return (0, import_node_path4.join)(process.env.LOCALAPPDATA ?? (0, import_node_path4.join)((0, import_node_os2.homedir)(), "AppData", "Local"), "agenthub");
    case "darwin":
      return (0, import_node_path4.join)((0, import_node_os2.homedir)(), "Library", "Application Support", "agenthub");
    default:
      return (0, import_node_path4.join)((0, import_node_os2.homedir)(), ".local", "share", "agenthub");
  }
}
function getBridgeLogPath() {
  return (0, import_node_path4.join)(getInstallDir(), "logs", "bridge.log");
}
function getExtensionLogPath() {
  return (0, import_node_path4.join)(getInstallDir(), "logs", "extension.log");
}
function getLegacyBridgeLogPath() {
  return (0, import_node_path4.join)(getInstallDir(), "bridge.log");
}
function migrateLegacyBridgeLog() {
  const legacy = getLegacyBridgeLogPath();
  const target = (0, import_node_path4.join)(getInstallDir(), "logs", "bridge.log.legacy");
  try {
    if (!(0, import_node_fs5.existsSync)(legacy)) return;
    if ((0, import_node_fs5.existsSync)(target)) return;
    const dir = (0, import_node_path4.join)(getInstallDir(), "logs");
    if (!(0, import_node_fs5.existsSync)(dir)) (0, import_node_fs5.mkdirSync)(dir, { recursive: true });
    (0, import_node_fs5.renameSync)(legacy, target);
  } catch {
  }
}
var _bridgeLogger = null;
function bridgeLog() {
  if (!_bridgeLogger) {
    _bridgeLogger = makeLogger({ filePath: getBridgeLogPath() }, "bridge", process.pid);
  }
  return _bridgeLogger;
}
function startServer(port) {
  serverPort = port;
  migrateLegacyBridgeLog();
  initRemoteSink(getInstallDir());
  const allowedExtensionIds = loadAllowedExtensionIds();
  bridgeLog().info("bridge.lifecycle.start", {
    port,
    version: VERSION,
    buildId: BUILD_ID,
    startedBy: process.env.AI_BROWSER_COPILOT_STARTED_BY ?? "service",
    allowedExtensionIdsCount: allowedExtensionIds.size,
    // Log only the first 8 chars of each allowlisted ID. Enough for an LLM
    // debugging an origin rejection ("which IDs ARE allowed?") without
    // leaking the full ID to anyone reading the log. Real Chrome extension
    // IDs are 32 chars; first 8 chars uniquely identify the install on a
    // typical user's machine.
    allowedExtensionIdsSample: Array.from(allowedExtensionIds).map((id) => id.slice(0, 8) + "\u2026"),
    // logFilePath stripped to the relative tail so user paths don't leak.
    logFilePath: getBridgeLogPath().replace(/^.*[\\/]agenthub[\\/]/i, "%LOCALAPPDATA%/agenthub/")
  });
  const ORIGIN_LOG_DEDUPE_WINDOW_MS = 6e4;
  const originLogState = /* @__PURE__ */ new Map();
  function emitOriginEvent(eventName, lvl, payload) {
    const key = `${eventName}:${payload.origin}`;
    const now = Date.now();
    const state = originLogState.get(key);
    if (state && now - state.lastLoggedAt < ORIGIN_LOG_DEDUPE_WINDOW_MS) {
      state.suppressed++;
      return;
    }
    const extras = { ...payload };
    if (state && state.suppressed > 0) {
      extras.suppressedSinceLastLog = state.suppressed;
    }
    originLogState.set(key, { lastLoggedAt: now, suppressed: 0 });
    if (lvl === "info") bridgeLog().info(eventName, extras);
    else bridgeLog().warn(eventName, extras);
  }
  const httpServer = (0, import_node_http2.createServer)((req, res) => {
    handleDiagRequest(req, res, {
      onRestartRequest: () => {
        bridgeLog().info("bridge.lifecycle.restart_requested", { initiator: "diag-ui" });
        process.exit(0);
      },
      onReloadExtensionRequest: (browserId) => {
        let count = 0;
        let matchedBrowserId;
        if (browserId) {
          const ws = browserSockets.get(browserId);
          if (ws && ws.readyState === import_websocket.default.OPEN) {
            try {
              ws.send(JSON.stringify({ type: "reload", source: "diag-ui" }));
              count = 1;
              matchedBrowserId = browserId;
            } catch {
            }
          }
          bridgeLog().info("bridge.diag.reload_extension_targeted", {
            browserId,
            delivered: count > 0
          });
        } else {
          for (const [, ws] of browserSockets) {
            if (ws.readyState === import_websocket.default.OPEN) {
              try {
                ws.send(JSON.stringify({ type: "reload", source: "diag-ui" }));
                count++;
              } catch {
              }
            }
          }
          bridgeLog().info("bridge.diag.reload_extension_broadcast", { count });
        }
        return { broadcastTo: count, ...matchedBrowserId ? { matchedBrowserId } : {} };
      },
      getState: () => {
        const requests = recentActivity.snapshot().requests;
        const browserCounts = /* @__PURE__ */ new Map();
        const clientCounts = /* @__PURE__ */ new Map();
        for (const r of requests) {
          if (r.browserId) browserCounts.set(r.browserId, (browserCounts.get(r.browserId) ?? 0) + 1);
          if (r.clientId) clientCounts.set(r.clientId, (clientCounts.get(r.clientId) ?? 0) + 1);
        }
        return {
          bridge: {
            version: VERSION,
            buildId: BUILD_ID,
            pid: process.pid,
            port,
            uptimeSec: Math.floor((Date.now() - startTime) / 1e3),
            startedBy: process.env.AI_BROWSER_COPILOT_STARTED_BY ?? "service",
            allowedExtensionIdsCount: allowedExtensionIds.size,
            allowedExtensionIdsSample: Array.from(allowedExtensionIds).map((id) => id.slice(0, 8) + "\u2026")
          },
          browsers: Array.from(browserRegistry.entries()).map(([browserId, info]) => {
            const lastSeenMs = browserLastSeen.get(browserId);
            const ageSec = lastSeenMs ? Math.floor((Date.now() - lastSeenMs) / 1e3) : null;
            let liveness = "unknown";
            if (ageSec !== null) {
              liveness = ageSec < 45 ? "live" : "stale";
            }
            return {
              browserId,
              connectedAt: info.connectedAt,
              recentRequestCount: browserCounts.get(browserId) ?? 0,
              lastSeenAt: lastSeenMs ? new Date(lastSeenMs).toISOString() : null,
              lastSeenAgeSec: ageSec,
              liveness
            };
          }),
          mcpClients: Array.from(mcpClientRegistry.entries()).map(([clientId, info]) => ({
            clientId,
            transport: info.transport,
            connectedAt: info.connectedAt,
            ...info.clientInfo ? { clientInfo: info.clientInfo } : {},
            recentRequestCount: clientCounts.get(clientId) ?? 0
          })),
          recentActivity
        };
      },
      logPaths: () => ({
        bridge: getBridgeLogPath(),
        extension: getExtensionLogPath(),
        helper: (0, import_node_path4.join)(getInstallDir(), "logs", "helper.log")
      })
    });
  });
  const wss = new import_websocket_server.default({
    server: httpServer,
    // Cap incoming frame size at 4 MiB. Real tool requests max out around
    // 200 KB (page snapshots); 4 MiB headroom is generous. Beyond this,
    // ws closes the connection — protects bridge memory from a runaway
    // log_batch or malicious page-scraping tool result.
    maxPayload: 4 * 1024 * 1024,
    verifyClient: (info, done) => {
      const origin = info.origin ?? "(none)";
      if (isAllowedOrigin(info.origin, allowedExtensionIds)) {
        emitOriginEvent("bridge.ws.upgrade_accepted", "info", { origin });
        done(true);
      } else {
        emitOriginEvent("bridge.ws.upgrade_rejected", "warn", {
          origin,
          reason: "origin_not_in_allowlist"
        });
        recentActivity.noteRejection(origin, "origin_not_in_allowlist");
        done(false, 401, "forbidden origin");
      }
    }
  });
  const LISTEN_DEADLINE_MS = 5e3;
  const listenWatchdog = setTimeout(() => {
    bridgeLog().warn("bridge.lifecycle.listen_timeout", {
      port,
      timeoutMs: LISTEN_DEADLINE_MS,
      action: "exiting_lost_bind_race",
      hint: "Never became listening and never errored (port held by a sibling; common on Windows). Exiting so we do not linger as a zombie."
    });
    process.exit(0);
  }, LISTEN_DEADLINE_MS);
  if (typeof listenWatchdog.unref === "function") listenWatchdog.unref();
  httpServer.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      bridgeLog().warn("bridge.lifecycle.port_in_use", {
        port,
        action: "exiting_without_lock_cleanup",
        hint: "Another bridge already holds this port; leaving the running instance\u2019s lock file intact."
      });
    } else {
      bridgeLog().error("bridge.lifecycle.listen_failed", { port, ...redactError(err) });
    }
    clearTimeout(listenWatchdog);
    process.exit(0);
  });
  httpServer.on("listening", () => {
    clearTimeout(listenWatchdog);
    try {
      writeLockFile({
        pid: process.pid,
        port,
        token: "",
        ipcPath: "",
        startedAt: (/* @__PURE__ */ new Date()).toISOString(),
        version: VERSION,
        startedBy: process.env.AI_BROWSER_COPILOT_STARTED_BY ?? "service"
      });
      registerCleanupHandlers();
    } catch (err) {
      bridgeLog().error("bridge.lifecycle.lock_file_write_failed", { ...redactError(err) });
    }
  });
  httpServer.listen(port, "127.0.0.1");
  process.on("uncaughtException", (err) => {
    bridgeLog().error("bridge.lifecycle.uncaught", { ...redactError(err) });
    setTimeout(() => {
      throw err;
    }, 0);
  });
  process.on("unhandledRejection", (reason) => {
    bridgeLog().error("bridge.lifecycle.unhandled_rejection", { ...redactError(reason) });
  });
  wss.on("connection", (ws, req) => {
    const params = parseQuery(req.url);
    if (params.get("role") === "mcp") {
      handleMcpClient(ws);
    } else {
      handleExtension(ws, params.get("browserId") || "default");
    }
  });
  const BROWSER_LIVENESS_INTERVAL_MS = 15e3;
  const livenessTimer = setInterval(async () => {
    const browsers = Array.from(browserSockets.entries()).filter(([id]) => id !== HELPER_PROBE_BROWSER_ID);
    for (const [browserId, ws] of browsers) {
      if (ws.readyState !== import_websocket.default.OPEN) continue;
      const alive = await proveLive(browserId, ws, LIVENESS_PROBE_TIMEOUT_MS);
      if (!alive) {
        bridgeLog().warn("bridge.browser.liveness_failed", {
          browserId,
          reason: "no_pong_to_periodic_probe",
          action: "closing_socket_to_force_reconnect"
        });
        try {
          ws.close(1011, "liveness_probe_failed");
        } catch {
        }
      }
    }
  }, BROWSER_LIVENESS_INTERVAL_MS);
  process.on("exit", () => clearInterval(livenessTimer));
  const stdioFormat = { format: "ndjson" };
  parseStdioMessages(process.stdin, (json) => {
    handleMcpMessage("stdio", json, (msg) => {
      const body = JSON.stringify(msg);
      if (stdioFormat.format === "lsp") {
        process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r
\r
${body}`);
      } else {
        process.stdout.write(`${body}
`);
      }
    });
  }, stdioFormat);
  if (typeof process.stdin.resume === "function") {
    process.stdin.resume();
  }
  bridgeLog().info("bridge.mcp.client_connected", { clientId: "stdio", transport: "stdio" });
  mcpClientRegistry.set("stdio", { transport: "stdio", connectedAt: (/* @__PURE__ */ new Date()).toISOString() });
}
function parseStdioMessages(stream, onMessage, formatHolder) {
  let buffer2 = Buffer.alloc(0);
  let contentLength = -1;
  let latched = false;
  const latch = (f) => {
    if (formatHolder && !latched) {
      formatHolder.format = f;
      latched = true;
    }
  };
  stream.on("data", (chunk) => {
    buffer2 = Buffer.concat([buffer2, typeof chunk === "string" ? Buffer.from(chunk) : chunk]);
    while (true) {
      if (contentLength !== -1) {
        if (buffer2.length < contentLength) break;
        const json = buffer2.subarray(0, contentLength).toString();
        buffer2 = buffer2.subarray(contentLength);
        contentLength = -1;
        latch("lsp");
        onMessage(json);
        continue;
      }
      let i = 0;
      while (i < buffer2.length && (buffer2[i] === 10 || buffer2[i] === 13 || buffer2[i] === 32 || buffer2[i] === 9)) i++;
      if (i > 0) buffer2 = buffer2.subarray(i);
      if (buffer2.length === 0) break;
      if (buffer2[0] === 123 || buffer2[0] === 91) {
        const nl = buffer2.indexOf(10);
        if (nl === -1) break;
        const line = buffer2.subarray(0, nl).toString().replace(/\r$/, "");
        buffer2 = buffer2.subarray(nl + 1);
        if (line) {
          latch("ndjson");
          onMessage(line);
        }
        continue;
      }
      const headerEnd = buffer2.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;
      const header = buffer2.subarray(0, headerEnd).toString();
      const m = header.match(/Content-Length:\s*(\d+)/i);
      buffer2 = buffer2.subarray(headerEnd + 4);
      if (m) {
        contentLength = parseInt(m[1], 10);
      }
    }
  });
}

// src/index.ts
var PORT = 7483;
if (process.argv.includes("--version")) {
  process.stdout.write(`${VERSION}
`);
  process.exit(0);
}
var isServiceMode = process.argv.includes("--service");
if (isServiceMode) {
  process.env.AI_BROWSER_COPILOT_STARTED_BY = "autostart";
}
process.stdin.pause();
var probe = import_node_net.default.createServer();
probe.listen(PORT, "127.0.0.1", () => {
  probe.close(() => startServer(PORT));
});
probe.on("error", () => {
  const ws = new import_websocket.default(`ws://127.0.0.1:${PORT}?role=mcp`);
  const pending = [];
  let wsReady = false;
  let stdioFormat = "ndjson";
  let formatLatched = false;
  const latch = (f) => {
    if (!formatLatched) {
      stdioFormat = f;
      formatLatched = true;
    }
  };
  let parseBuf = Buffer.alloc(0);
  let contentLength = -1;
  function feedParser(chunk) {
    parseBuf = Buffer.concat([parseBuf, chunk]);
    while (true) {
      if (contentLength !== -1) {
        if (parseBuf.length < contentLength) break;
        const json = parseBuf.subarray(0, contentLength).toString();
        parseBuf = parseBuf.subarray(contentLength);
        contentLength = -1;
        latch("lsp");
        if (wsReady) ws.send(json);
        continue;
      }
      let i = 0;
      while (i < parseBuf.length && (parseBuf[i] === 10 || parseBuf[i] === 13 || parseBuf[i] === 32 || parseBuf[i] === 9)) i++;
      if (i > 0) parseBuf = parseBuf.subarray(i);
      if (parseBuf.length === 0) break;
      if (parseBuf[0] === 123 || parseBuf[0] === 91) {
        const nl = parseBuf.indexOf(10);
        if (nl === -1) break;
        const line = parseBuf.subarray(0, nl).toString().replace(/\r$/, "");
        parseBuf = parseBuf.subarray(nl + 1);
        if (line) {
          latch("ndjson");
          if (wsReady) ws.send(line);
        }
        continue;
      }
      const headerEnd = parseBuf.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;
      const header = parseBuf.subarray(0, headerEnd).toString();
      const match = header.match(/Content-Length:\s*(\d+)/i);
      parseBuf = parseBuf.subarray(headerEnd + 4);
      if (match) {
        contentLength = parseInt(match[1], 10);
      }
    }
  }
  process.stdin.on("data", (chunk) => {
    if (wsReady) {
      feedParser(Buffer.from(chunk));
    } else {
      pending.push(Buffer.from(chunk));
    }
  });
  process.stdin.resume();
  ws.on("open", () => {
    wsReady = true;
    for (const chunk of pending) feedParser(chunk);
    pending.length = 0;
    ws.on("message", (data) => {
      const body = data.toString();
      if (stdioFormat === "lsp") {
        process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r
\r
${body}`);
      } else {
        process.stdout.write(`${body}
`);
      }
    });
  });
  ws.on("close", () => process.exit(0));
  ws.on("error", () => process.exit(1));
  process.stdin.on("end", () => {
    ws.close();
    process.exit(0);
  });
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  VERSION
});
