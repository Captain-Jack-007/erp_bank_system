// Expo SDK 52+ автоматически настраивает Metro для монорепозитория (npm workspaces),
// поэтому пакет @xb/shared подхватывается без дополнительных настроек.
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
