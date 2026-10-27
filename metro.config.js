// Metro (the bundler) config: Expo's defaults, plus ONE rule (speed, 2026-10-27).
//
// src/lib/observability.ts loads @sentry/browser on the web and @sentry/react-native on phones. Both requires are
// static, so Metro bundled the NATIVE SDK into the web bundle too (~250 KB of unused code: RN tracing, mobile replay,
// feedback), measured in the served entry bundle on ezhalah.com. On web that branch can never run, so the web build
// resolves @sentry/react-native to an empty module. Native builds are untouched.
// Guarded by scripts/verify-web-bundle-skips-native-sentry.ts.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const NATIVE_ONLY_ON_WEB = new Set(['@sentry/react-native']);
const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && NATIVE_ONLY_ON_WEB.has(moduleName)) return { type: 'empty' };
  return defaultResolve ? defaultResolve(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
