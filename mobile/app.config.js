// Extends app.json. The Google Maps key (needed only for standalone Android/iOS builds, not Expo Go)
// is read from the environment so it is never committed:  GOOGLE_MAPS_API_KEY=... npx expo start
module.exports = ({ config }) => {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return config;
  return {
    ...config,
    ios: { ...config.ios, config: { ...(config.ios && config.ios.config), googleMapsApiKey: key } },
    android: { ...config.android, config: { ...(config.android && config.android.config), googleMaps: { apiKey: key } } },
  };
};
