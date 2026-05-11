(function () {
  'use strict';

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

  window.__shimSetToken = _setToken;
  window.__shimGetToken = _getToken;

  async function _rpc(fn, args, successHandler, failureHandler) {
    let callArgs = Array.from(args);
    if (fn !== 'login') {
      const tok = _getToken();
      if (tok && (!callArgs[0] || typeof callArgs[0] !== 'string' || callArgs[0].length < 10)) {
        callArgs = [tok, ...callArgs];
      }
    }
    try {
      const resp = await fetch('/api/rpc', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ fn, args: callArgs }),
        credentials: 'include',
      });
      const data = await resp.json();
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

  // ── FIXED: each chain gets its own fresh proxy ──
  function makeRunProxy() {
    let _success = null;
    let _failure = null;

    const proxy = new Proxy({}, {
      get(target, prop) {
        if (prop === 'withSuccessHandler') {
          return function (fn) { _success = fn; return proxy; };
        }
        if (prop === 'withFailureHandler') {
          return function (fn) { _failure = fn; return proxy; };
        }
        if (prop === 'withUserObject') {
          return function () { return proxy; };
        }
        return function (...args) {
          _rpc(prop, args, _success, _failure);
        };
      }
    });
    return proxy;
  }

  const _url = {
    getLocation: function (cb) {
      cb({ parameter: {}, parameters: {} });
    },
  };

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