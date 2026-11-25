/* Dedicated handler for /oauth/callback.html — keeps inline script out of CSP. */
(async function () {
  'use strict';
  var O = window.VSOauth;
  var I = window.VSI18n;
  var lang = I.detectLanguage(window.navigator);
  try {
    var saved = JSON.parse(window.localStorage.getItem('vsw.lang'));
    if (I.known(saved)) lang = saved;
  } catch (e) { /* Keep browser detection when storage is unavailable. */ }
  try { lang = await I.load(lang); } catch (e) { /* Retain key fallback offline. */ }
  document.documentElement.lang = I.meta(lang).htmlLang || lang;

  var title = document.getElementById('title');
  var msg = document.getElementById('msg');
  var back = document.getElementById('back');
  var backButton = document.getElementById('back-link');
  title.textContent = I.t(lang, 'oauth_callback_returning');
  msg.textContent = title.textContent;
  backButton.textContent = I.t(lang, 'oauth_callback_return');
  var returnHash;
  backButton.addEventListener('click', function () {
    // Stay in this tab and restore the saved app tab when available.
    var hash = returnHash || (O && O.consumeReturnHash());
    window.location.replace(O ? O.homeUrl(hash || 'chat') : '../');
  });

  function showError() {
    document.getElementById('progress').hidden = true;
    title.className = 'callback-failed';
    title.textContent = I.t(lang, 'oauth_callback_failed');
    document.title = title.textContent + ' · Video Studio';
    msg.textContent = I.t(lang, 'oauth_callback_failure_message');
    msg.hidden = false;
    back.hidden = false;
  }

  if (!O) {
    showError();
    return;
  }

  O.handleCallback(window.location.search).then(function (result) {
    if (!result || !result.ok) {
      showError();
      return;
    }
    var hash = O.consumeReturnHash() || 'chat';
    returnHash = hash;
    msg.textContent = I.t(lang, 'oauth_callback_returning');
    if (result.returnToStandalone) {
      document.getElementById('progress').hidden = true;
      msg.textContent = I.t(lang, 'oauth_standalone_return');
      msg.hidden = false;
      back.hidden = false;
      return;
    }
    window.location.replace(O.homeUrl(hash));
  }, showError);
})();
