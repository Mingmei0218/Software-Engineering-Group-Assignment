const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// 配置路径别名
config.resolver.extraNodeModules = {
  '@': path.resolve(__dirname),
};

module.exports = config;
