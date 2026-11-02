/* Dedicated handler for /oauth/callback.html — keeps inline script out of CSP. */
(function () {
  'use strict';
  var O = window.VSOauth;
  var title = document.getElementById('title');
  var msg = document.getElementById('msg');
  var errEl = document.getElementById('err');
  var back = document.getElementById('back');
  var backLink = document.getElementById('back-link');

  function showError(text) {
    title.textContent = 'Sign-in failed';
    msg.textContent = 'Could not finish PowerTokens login.';
    errEl.hidden = false;
    errEl.textContent = text || 'Unknown error';
    back.hidden = false;
    if (backLink && O) backLink.href = O.homeUrl('key');
  }

  if (!O) {
    showError('OAuth module missing');
    return;
  }
  if (backLink) backLink.href = O.homeUrl('key');

  O.handleCallback(window.location.search).then(function (result) {
    if (!result || !result.ok) {
      var detail = (result && (result.error_description || result.error)) || 'callback_failed';
      showError(String(detail));
      return;
    }
    var hash = O.consumeReturnHash() || 'key';
    title.textContent = 'Signed in';
    msg.textContent = 'Redirecting back to Video Studio…';
    window.location.replace(O.homeUrl(hash));
  }, function () {
    showError('network');
  });
})();
