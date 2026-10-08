/**
 * RouteOverlay.tsx
 * Renders the active computed route navigation path on the map.
 */

import React from 'react';
import { Polyline } from 'react-native-maps';
import { Route } from '../types/types';

interface RouteOverlayProps {
  route: Route | null;
}

export const RouteOverlay: React.FC<RouteOverlayProps> = ({ route }) => {
  if (!route || !route.success || !route.coordinates || route.coordinates.length < 2) {
    return null;
  }

  const isDetour = route.blockedRoads.length > 0;
  // Detour is vibrant blue/amber highlighted, primary route is emerald
  const strokeColor = isDetour ? '#2563EB' : '#059669';

  return (
    <>
      {/* Route background halo for contrast */}
      <Polyline
        coordinates={route.coordinates}
        strokeColor="#FFFFFF"
        strokeWidth={7}
        zIndex={5}
      />
      {/* Active route foreground line */}
      <Polyline
        coordinates={route.coordinates}
        strokeColor={strokeColor}
        strokeWidth={5}
        zIndex={6}
      />
    </>
  );
};
