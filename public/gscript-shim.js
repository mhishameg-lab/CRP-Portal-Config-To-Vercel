/**
 * gscript-shim.js — Drop-in replacement for google.script.run
 *
 * In GAS the frontend calls:
 *   google.script.run
 *     .withSuccessHandler(cb)
 *     .withFailureHandler(onErr)
 *     .someFunction(arg1, arg2);
 *
 * This shim intercepts those calls and routes them to POST /api/rpc instead,
 * so the existing HTML frontend works with zero changes.
 *
 * Usage: include this script BEFORE any other app scripts in index.html:
 *   <script src="/gscript-shim.js"></script>
 */

(function () {
  'use strict';

  // Token storage — mirrors the GAS frontend's APP.token pattern.
  // The shim reads APP.token automatically if it exists.
  let _token = null;

  function _getToken() {
    if (_token) return _token;
    if (typeof APP !== 'undefined' && APP.token) return APP.token;
    try { return sessionStorage.getItem('ico_token'); } catch (_) { return null; }
  }

  function _setToken(t) {
    _token = t;
    try { if (t) sessionStorage.setItem('ico_token', t); else sessionStorage.removeItem('ico_token'); } catch (_) {}
  }

  // Expose so existing code can still do: APP.token = result.token
  window.__shimSetToken = _setToken;
  window.__shimGetToken = _getToken;

  // ── RPC call ────────────────────────────────────────────────────────────────

  async function _rpc(fn, args, successHandler, failureHandler) {
    // Inject token as args[0] for all calls except login
    let callArgs = Array.from(args);
    if (fn !== 'login') {
      const tok = _getToken();
      // If first arg isn't already a JWT/UUID, prepend token
      if (tok && (!callArgs[0] || typeof callArgs[0] !== 'string' || callArgs[0].length < 10)) {
        callArgs = [tok, ...callArgs];
      }
    }

    try {
      const resp = await fetch('/api/rpc', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ fn, args: callArgs }),
        credentials: 'include',  // send httpOnly cookie
      });

      const data = await resp.json();

      // Auto-capture token from login response
      if (fn === 'login' && data?.success && data.token) {
        _setToken(data.token);
      }

      if (resp.ok) {
        if (successHandler) successHandler(data);
      } else {
        if (failureHandler) failureHandler(new Error(data?.error || `HTTP ${resp.status}`));
      }
    } catch (err) {
      if (failureHandler) failureHandler(err);
    }
  }

  // ── google.script.run proxy ──────────────────────────────────────────────────

  function RunProxy() {
    this._success = null;
    this._failure = null;
  }

  RunProxy.prototype.withSuccessHandler = function (fn) {
    this._success = fn;
    return this;
  };

  RunProxy.prototype.withFailureHandler = function (fn) {
    this._failure = fn;
    return this;
  };

  RunProxy.prototype.withUserObject = function () {
    return this; // no-op — GAS compat
  };

  // Build a dynamic proxy so any property access returns a callable
function makeRunProxy() {
    let _success = null;
    let _failure = null;

    const proxy = new Proxy({}, {
        get(target, prop) {
            if (prop === 'withSuccessHandler') {
                return function(fn) { _success = fn; return proxy; };
            }
            if (prop === 'withFailureHandler') {
                return function(fn) { _failure = fn; return proxy; };
            }
            if (prop === 'withUserObject') {
                return function() { return proxy; };
            }
            return function(...args) {
                _rpc(prop, args, _success, _failure);
            };
        }
    });
    return proxy;
}

  // ── google.script.url (stub) ─────────────────────────────────────────────────

  const _url = {
    getLocation: function (cb) {
      cb({ parameter: {}, parameters: {} });
    },
  };

  // ── Expose global ────────────────────────────────────────────────────────────

  window.google = window.google || {};
  window.google.script = {
      get run() { return makeRunProxy(); },
      url : _url,
      host: {
          close : function () { console.warn('google.script.host.close() — no-op'); },
          editor: {},
      },
  };

  console.log('[gscript-shim] google.script.run → /api/rpc active');
})();
