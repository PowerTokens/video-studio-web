/**
 * PostHog project settings for Video Studio web.
 *
 * Leave posthogProjectKey empty in git. Fill it at deploy time. An empty key
 * means no events are sent. This is the public project API key (phc_...), not a
 * personal credential.
 *
 * Config names (first non-empty wins):
 *   window.VS_POSTHOG_PROJECT_KEY
 *   window.VS_POSTHOG_HOST
 *   window.VS_ANALYTICS_CONFIG.posthogProjectKey
 *   window.VS_ANALYTICS_CONFIG.posthogHost
 *
 * Default host: https://us.i.posthog.com  (EU: https://eu.i.posthog.com)
 */
(function (root) {
  'use strict';
  var existing = root.VS_ANALYTICS_CONFIG || {};
  root.VS_ANALYTICS_CONFIG = {
    posthogProjectKey: existing.posthogProjectKey || '',
    posthogHost: existing.posthogHost || 'https://us.i.posthog.com'
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
