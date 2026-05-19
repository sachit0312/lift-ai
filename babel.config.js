module.exports = function (api) {
  // Cache by NODE_ENV so test/dev/prod each get their own transforms.
  api.cache.using(() => process.env.NODE_ENV);
  const isTest = process.env.NODE_ENV === 'test';
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Under jest, transform `import()` to require() so React.lazy resolves
      // synchronously (avoids the experimental-vm-modules flag). Metro untouched.
      ...(isTest ? ['dynamic-import-node'] : []),
      'react-native-reanimated/plugin',
    ],
  };
};
