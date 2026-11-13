/* Keep message scrolling and the reply dock inside the visible chat room. */
(function () {
  'use strict';
  var page = document.querySelector('.page');
  var dock = document.querySelector('.chat-dock');
  var statusbar = document.querySelector('.statusbar');
  if (!page || !dock) return;

  function update() {
    var shell = document.querySelector('.chat-shell');
    var viewport = window.visualViewport;
    var banner = document.querySelector('.pwa-install-banner');
    var bannerSpace = banner && !banner.hidden && window.matchMedia('(min-width: 641px)').matches ? banner.getBoundingClientRect().height + (parseFloat(window.getComputedStyle(banner).bottom) || 0) : 0;
    if (shell && shell.getBoundingClientRect().height) {
      page.style.setProperty('--chat-room-height', Math.max(180, (window.matchMedia('(max-width: 640px)').matches ? window.innerHeight : (viewport ? viewport.height + viewport.offsetTop : window.innerHeight)) - shell.getBoundingClientRect().top - bannerSpace) + 'px');
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
    var inset = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
    page.style.setProperty('--chat-viewport-inset', inset + 'px');
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
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', update);
    window.visualViewport.addEventListener('scroll', update);
  }
  var input = document.getElementById('chat-input');
  function grow() {
    input.style.height = 'auto';
    input.style.height = Math.min(180, Math.max(78, input.scrollHeight)) + 'px';
    update();
  }
  if (input) {
    input.addEventListener('input', grow);
    new MutationObserver(grow).observe(input, { attributes: true, attributeFilter: ['disabled'] });
  }
  update();
}());
