/**
 * PostHog project settings for Video Studio web.
 *
 * posthogProjectKey is the public project capture token (phc_...), which is
 * safe to ship in the static client. It is not a personal or admin key.
 * An empty or rejected key means no events are sent.
 *
 * Config names (first non-empty wins):
 *   window.VS_POSTHOG_PROJECT_KEY
 *   window.VS_POSTHOG_HOST
 *   window.VS_ANALYTICS_CONFIG.posthogProjectKey
 *   window.VS_ANALYTICS_CONFIG.posthogHost
 *   window.VS_ANALYTICS_ENVIRONMENT (synthetic | test | production)
 *
 * Default host: https://us.i.posthog.com  (EU: https://eu.i.posthog.com)
 * Default environment: production (override for synthetic/test runs).
 */
(function (root) {
  'use strict';
  var existing = root.VS_ANALYTICS_CONFIG || {};
  root.VS_ANALYTICS_CONFIG = {
    posthogProjectKey: existing.posthogProjectKey || "",
    posthogHost: existing.posthogHost || "https://us.i.posthog.com",
    environment: existing.environment || 'production'
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
