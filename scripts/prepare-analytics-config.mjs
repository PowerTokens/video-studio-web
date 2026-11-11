#!/usr/bin/env node
/**
 * Write untracked js/analytics-config.local.js from env or a dotenv file.
 * Only a public project capture key (phc_...) is accepted. Never prints secrets.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY_RE = /^phc_[A-Za-z0-9_-]{4,}$/;
const HOSTS = new Set(['https://us.i.posthog.com', 'https://eu.i.posthog.com']);

function publicKey(raw) {
  const key = String(raw || '').trim();
  return KEY_RE.test(key) ? key : '';
}
function officialHost(raw) {
  const host = String(raw || '').trim().replace(/\/$/, '');
  return HOSTS.has(host) ? host : '';
}
function readDotenv(file) {
  const values = {};
  if (!file || !fs.existsSync(file)) return values;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    values[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return values;
}

const args = process.argv.slice(2);
let envFile = '';
let allowEmpty = false;
let out = path.join(root, 'js', 'analytics-config.local.js');
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--from-env-file') envFile = args[++i];
  else if (args[i] === '--allow-empty') allowEmpty = true;
  else if (args[i] === '--out') out = args[++i];
}
const fileVals = readDotenv(envFile);
const rawCandidates = [
  process.env.VS_POSTHOG_PROJECT_KEY,
  fileVals.VS_POSTHOG_PROJECT_KEY,
  fileVals.POSTHOG_PROJECT_KEY,
  fileVals.POSTHOG_PROJECT_TOKEN,
];
const key = publicKey(rawCandidates.find(Boolean));
const host = officialHost(process.env.VS_POSTHOG_HOST || fileVals.VS_POSTHOG_HOST || fileVals.POSTHOG_HOST) || 'https://us.i.posthog.com';
const rejected = rawCandidates.some((v) => String(v || '').trim() && !publicKey(v));
if (!key) {
  if (rejected) {
    console.error('prepare-analytics-config: refused a non-project (non-phc_) key; nothing written');
    process.exit(2);
  }
  if (allowEmpty) {
    console.log('prepare-analytics-config: no public project key; skip write');
    process.exit(0);
  }
  console.error('prepare-analytics-config: no public project key provided');
  process.exit(1);
}
const body = `/**
 * Generated local PostHog project (public capture) settings. Do not commit.
 * Load this file after js/analytics-config.js in a private/local page only.
 * Personal or admin API keys must never be placed here.
 */
(function (root) {
  'use strict';
  root.VS_ANALYTICS_CONFIG = {
    posthogProjectKey: ${JSON.stringify(key)},
    posthogHost: ${JSON.stringify(host)}
  };
  root.VS_POSTHOG_PROJECT_KEY = root.VS_ANALYTICS_CONFIG.posthogProjectKey;
  root.VS_POSTHOG_HOST = root.VS_ANALYTICS_CONFIG.posthogHost;
})(typeof globalThis !== 'undefined' ? globalThis : window);
`;
fs.writeFileSync(out, body, { mode: 0o600 });
console.log(`prepare-analytics-config: wrote ${path.basename(out)} (key=phc_… len=${key.length}, host=${host})`);
