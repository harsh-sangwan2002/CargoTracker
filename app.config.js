// Extends app.json with values that come from the environment at build time.
// The Google Maps key is optional: without it the maps plugin adds nothing to the
// Android manifest and LiveMapScreen falls back to the driver list (MapView
// crashes on Android when no key is present).
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    config: {
      ...config.android?.config,
      googleMaps: { apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY },
    },
  },
});
