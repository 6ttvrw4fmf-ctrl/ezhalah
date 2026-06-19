module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Reanimated 4 is powered by react-native-worklets; its Babel plugin must be
    // listed LAST so it can transform worklets after everything else runs.
    // Without this, useAnimatedStyle/withTiming never compile and animations
    // snap instead of easing — the "harsh / rough" button feel.
    plugins: ['react-native-worklets/plugin'],
  };
};
