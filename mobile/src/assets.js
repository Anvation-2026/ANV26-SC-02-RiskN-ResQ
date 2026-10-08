// The RiskN ResQ logo and symbol set (PNGs rendered from the SVG sources in assets/symbols/ and assets/brand/).
export const symbols = {
  logo: require('../assets/symbols/png/logo.png'),                // the rq mark on its tile (assets/brand/rq-mark.svg)
  map: require('../assets/symbols/png/08-pin-drop.png'),          // Map / flood location
  route: require('../assets/symbols/png/11-alternative-route.png'), // Find route
  report: require('../assets/symbols/png/03-alert-wave.png'),     // Report incident
  help: require('../assets/symbols/png/04-lifebuoy.png'),         // Request help
  bell: require('../assets/symbols/png/12-alert-bell.png'),       // Alerts / notifications
  roadBlocked: require('../assets/symbols/png/07-road-barricade.png'), // Road status
  risk: require('../assets/symbols/png/14-risk-gauge.png'),       // Risk level
  rain: require('../assets/symbols/png/05-rain-cloud-alert.png'), // Hazard simulation
  verified: require('../assets/symbols/png/13-verified-shield.png'), // Trusted / verified
  medical: require('../assets/symbols/png/10-medical-cross.png'), // Resources: medicine / first aid
};

// Layers of the rq mark, aligned on the same square, for animation (see components/BrandMark.js).
export const brand = {
  tile: require('../assets/brand/rq-tile.png'),
  letters: require('../assets/brand/rq-letters.png'),
  wave: require('../assets/brand/rq-wave.png'),
};
