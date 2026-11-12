/* Phone chat chrome: reserve its actual height as copy and viewport change. */
(function () {
  'use strict';
  var page = document.querySelector('.page');
  var dock = document.querySelector('.chat-dock');
  var statusbar = document.querySelector('.statusbar');
  if (!page || !dock) return;

  function update() {
    if (!window.matchMedia('(max-width: 640px)').matches) return;
    var height = dock.getBoundingClientRect().height;
    if (height) page.style.setProperty('--chat-dock-height', height + 'px');
    if (statusbar) {
      page.style.setProperty('--chat-statusbar-height', statusbar.getBoundingClientRect().height + 'px');
    }
    var banner = document.querySelector('.pwa-install-banner');
    if (banner && !banner.hidden) {
      var bottom = parseFloat(window.getComputedStyle(banner).bottom) || 0;
      page.style.setProperty('--chat-banner-height', (banner.getBoundingClientRect().height + bottom) + 'px');
    }
    var viewport = window.visualViewport;
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
  update();
}());
