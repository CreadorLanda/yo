const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Native-only packages that need a stand-in in the browser.
const WEB_SHIMS = {
  'expo-secure-store': path.resolve(__dirname, 'shims/secure-store.web.ts'),
  'react-native-vision-camera': path.resolve(__dirname, 'shims/vision-camera.web.ts'),
  '@livekit/react-native': path.resolve(__dirname, 'shims/livekit-react-native.web.ts'),
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && WEB_SHIMS[moduleName]) {
    return { type: 'sourceFile', filePath: WEB_SHIMS[moduleName] };
  }
  // Hand on to the next resolver in Expo's chain, which is what maps
  // `react-native` to `react-native-web` on web.
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
