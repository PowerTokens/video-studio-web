/* Keep message scrolling and the reply dock inside the visible chat room. */
(function () {
  'use strict';
  var page = document.querySelector('.page');
  var dock = document.querySelector('.chat-dock');
  var statusbar = document.querySelector('.statusbar');
  if (!page || !dock) return;

  var PHONE = '(max-width: 640px)';
  var input = document.getElementById('chat-input');
  var keyboardOpen = false;

  function isPhone() {
    return window.matchMedia(PHONE).matches;
  }

  function chatVisible() {
    var panel = document.getElementById('panel-chat');
    return !!(panel && !panel.hidden);
  }

  function inputFocused() {
    return !!(input && document.activeElement === input);
  }

  function viewportMetrics() {
    var viewport = window.visualViewport;
    if (viewport) {
      return {
        width: viewport.width,
        height: viewport.height,
        offsetTop: viewport.offsetTop,
        offsetLeft: viewport.offsetLeft,
        inset: Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
      };
    }
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      offsetTop: 0,
      offsetLeft: 0,
      inset: 0
    };
  }

  function shouldLockToKeyboard(metrics) {
    if (!isPhone() || !chatVisible()) return false;
    if (inputFocused()) return true;
    // Keep the lock while the keyboard is still up after a brief blur.
    // A large visual inset is the fallback when focus is not reported.
    return metrics.inset > 80;
  }

  function lockDocumentScroll() {
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
    if (document.documentElement.scrollTop || (document.body && document.body.scrollTop)) {
      document.documentElement.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;
    }
  }

  function scrollLatestIntoView() {
    var scroller = document.querySelector('.chat-scroll');
    if (!scroller) return;
    scroller.scrollTop = scroller.scrollHeight;
  }

  function update() {
    var shell = document.querySelector('.chat-shell');
    var viewport = window.visualViewport;
    var metrics = viewportMetrics();
    var banner = document.querySelector('.pwa-install-banner');
    var bannerSpace = banner && !banner.hidden && window.matchMedia('(min-width: 641px)').matches ? banner.getBoundingClientRect().height + (parseFloat(window.getComputedStyle(banner).bottom) || 0) : 0;

    var lock = shouldLockToKeyboard(metrics);
    var lockChanged = lock !== keyboardOpen;
    if (lockChanged) {
      keyboardOpen = lock;
      if (document.body && document.body.classList) document.body.classList.toggle('chat-keyboard-open', lock);
      document.documentElement.classList.toggle('chat-keyboard-open', lock);
    }

    if (lock) {
      lockDocumentScroll();
      page.style.setProperty('--chat-vv-top', metrics.offsetTop + 'px');
      page.style.setProperty('--chat-vv-left', metrics.offsetLeft + 'px');
      page.style.setProperty('--chat-vv-width', metrics.width + 'px');
      page.style.setProperty('--chat-vv-height', metrics.height + 'px');
      // Header, tabs, and title are collapsed, so the room uses the full visual viewport.
      page.style.setProperty('--chat-room-height', Math.max(0, metrics.height) + 'px');
      page.style.setProperty('--chat-viewport-inset', '0px');
    } else {
      if (page.style.removeProperty) {
        page.style.removeProperty('--chat-vv-top');
        page.style.removeProperty('--chat-vv-left');
        page.style.removeProperty('--chat-vv-width');
        page.style.removeProperty('--chat-vv-height');
      }

      var visibleBottom = viewport ? viewport.height + viewport.offsetTop : window.innerHeight;
      // A standalone window can extend into the OS work-area reserved for a dock/taskbar.
      // Screen coordinates and viewport sizes are both CSS pixels. Ignore unavailable metrics.
      var screen = window.screen;
      if (window.matchMedia('(min-width: 641px)').matches && screen && screen.availHeight > 0 && window.outerHeight >= window.innerHeight) {
        var contentTop = window.screenY + window.outerHeight - window.innerHeight;
        var workBottom = screen.availTop + screen.availHeight - contentTop;
        if (workBottom > 0) visibleBottom = Math.min(visibleBottom, workBottom);
      }
      if (shell && shell.getBoundingClientRect().height) {
        page.style.setProperty('--chat-room-height', Math.max(0, visibleBottom - shell.getBoundingClientRect().top - bannerSpace - (window.matchMedia('(min-width: 641px)').matches ? 16 : 0)) + 'px');
      }
      var inset = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
      page.style.setProperty('--chat-viewport-inset', inset + 'px');
    }

    var height = dock.getBoundingClientRect().height;
    if (height) page.style.setProperty('--chat-dock-height', height + 'px');
    if (statusbar) {
      page.style.setProperty('--chat-statusbar-height', statusbar.getBoundingClientRect().height + 'px');
    }
    page.style.setProperty('--chat-banner-height', '0px');
    if (banner && !banner.hidden) {
      var bottom = parseFloat(window.getComputedStyle(banner).bottom) || 0;
      page.style.setProperty('--chat-banner-height', (banner.getBoundingClientRect().height + bottom) + 'px');
    }

    if (lock) {
      if (window.requestAnimationFrame) window.requestAnimationFrame(scrollLatestIntoView);
      else scrollLatestIntoView();
    }

    // After collapsing or restoring chrome, measure again on the next frame.
    if (lockChanged && window.requestAnimationFrame) {
      window.requestAnimationFrame(update);
    }
  }

  if (window.ResizeObserver) {
    var observer = new ResizeObserver(update);
    observer.observe(dock);
    if (statusbar) observer.observe(statusbar);
    // The install controller creates its banner after page load.
    new MutationObserver(function () {
      var banner = document.querySelector('.pwa-install-banner');
      if (banner) observer.observe(banner);
      update();
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
  }
  window.addEventListener('resize', update);
  window.addEventListener('focus', update);
  window.addEventListener('pageshow', update);
  window.addEventListener('scroll', function () {
    if (keyboardOpen) lockDocumentScroll();
  }, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', update);
    window.visualViewport.addEventListener('scroll', function () {
      if (keyboardOpen) lockDocumentScroll();
      update();
    });
  }
  function grow() {
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = Math.min(180, Math.max(78, input.scrollHeight)) + 'px';
    update();
  }
  if (input) {
    input.addEventListener('input', grow);
    input.addEventListener('focus', update);
    input.addEventListener('blur', function () {
      // iOS can fire blur before the keyboard has fully closed.
      setTimeout(update, 50);
      setTimeout(update, 300);
    });
    new MutationObserver(grow).observe(input, { attributes: true, attributeFilter: ['disabled'] });
  }
  update();
}());
