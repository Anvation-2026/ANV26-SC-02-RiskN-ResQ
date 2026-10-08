/**
 * DisasterResponseScreen.tsx
 * Complete standalone mobile screen orchestrating the RiskNResQ geospatial disaster response module.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, Platform, SafeAreaView, StatusBar, ScrollView } from 'react-native';
import { Location, Road, Route, Volunteer, MatchResult, HelpRequest } from './types/types';
import { PRIMARY_DEMO_RISK_ZONE, MOCK_RISK_ZONES } from './data/mockHazards';
import { INITIAL_MOCK_ROADS, INITIAL_ROAD_GRAPH } from './data/mockRoads';
import { MOCK_VOLUNTEERS } from './data/mockVolunteers';
import { getCurrentUserLocation, DEMO_FALLBACK_LOCATION } from './services/geolocation';
import { isInsideRiskZone, getRiskLevelColor } from './services/geofencing';
import { findRecommendedRoute, blockRoad, unblockRoad } from './services/routing';
import { findBestVolunteerMatch } from './services/matching';
import { DisasterMapView } from './components/DisasterMapView';
import { FallbackWebMap } from './components/FallbackWebMap';
import { RouteInfoCard } from './components/RouteInfoCard';
import { MatchResultCard } from './components/MatchResultCard';
import { DemoControlPanel } from './components/DemoControlPanel';

export const DisasterResponseScreen: React.FC = () => {
  // 1. STATE
  const [userLocation, setUserLocation] = useState<Location>(DEMO_FALLBACK_LOCATION);
  const [roads, setRoads] = useState<Road[]>(INITIAL_MOCK_ROADS);
  const [activeRoute, setActiveRoute] = useState<Route | null>(null);
  const [volunteers] = useState<Volunteer[]>(MOCK_VOLUNTEERS);
  const [selectedVolunteer, setSelectedVolunteer] = useState<Volunteer | null>(null);
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);

  // 2. INITIAL GEOLOCATION FETCH
  useEffect(() => {
    let isMounted = true;
    getCurrentUserLocation().then((loc) => {
      if (isMounted) {
        setUserLocation(loc);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  // 3. ROUTE COMPUTATION (Dijkstra from Node A to Node D)
  const recalculateRoute = useCallback((currentRoads: Road[]) => {
    const computedRoute = findRecommendedRoute('A', 'D', currentRoads, INITIAL_ROAD_GRAPH);
    setActiveRoute(computedRoute);
  }, []);

  // Compute initial route on mount
  useEffect(() => {
    recalculateRoute(roads);
  }, [recalculateRoute]);

  // 4. GEOFENCE ASSESSMENT
  const riskAssessment = useMemo(() => {
    return isInsideRiskZone(userLocation, PRIMARY_DEMO_RISK_ZONE);
  }, [userLocation]);

  const riskBadgeColors = getRiskLevelColor(riskAssessment.riskLevel);

  // 5. DEMO HANDLERS
  const handleBlockRoadA = useCallback(() => {
    const updatedRoads = blockRoad('ROAD_A', roads, 'Severe waterlogging / tree fall');
    setRoads(updatedRoads);
    recalculateRoute(updatedRoads);
  }, [roads, recalculateRoute]);

  const handleUnblockRoadA = useCallback(() => {
    const updatedRoads = unblockRoad('ROAD_A', roads);
    setRoads(updatedRoads);
    recalculateRoute(updatedRoads);
  }, [roads, recalculateRoute]);

  const handleFindAlternativeRoute = useCallback(() => {
    recalculateRoute(roads);
  }, [roads, recalculateRoute]);

  const handleRequestMedicine = useCallback(() => {
    const request: HelpRequest = {
      resource: 'Medicine',
      priority: 'HIGH',
      latitude: userLocation.latitude,
      longitude: userLocation.longitude,
    };

    const match = findBestVolunteerMatch(request, volunteers);
    setMatchResult(match);

    if (match.matched) {
      const vol = volunteers.find((v) => v.id === match.volunteer.id);
      if (vol) setSelectedVolunteer(vol);
    }
  }, [userLocation, volunteers]);

  const handleResetDemo = useCallback(() => {
    setRoads(INITIAL_MOCK_ROADS);
    recalculateRoute(INITIAL_MOCK_ROADS);
    setMatchResult(null);
    setSelectedVolunteer(null);
  }, [recalculateRoute]);

  const roadAStatus = roads.find((r) => r.id === 'ROAD_A')?.status || 'OPEN';

  const isWeb = Platform.OS === 'web';

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0F172A" />

      {/* TOP HEADER */}
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.appTitle}>RiskNResQ</Text>
          <View style={[styles.riskPill, { backgroundColor: riskBadgeColors.badgeBg }]}>
            <Text style={[styles.riskPillText, { color: riskBadgeColors.badgeText }]}>
              {riskAssessment.insideRiskZone ? `ZONE: ${riskAssessment.riskLevel}` : 'NORMAL ZONE'}
            </Text>
          </View>
        </View>
        <Text style={styles.appSubtitle}>
          Hyper-Local Disaster Early Warning & Resilient Routing
        </Text>
      </View>

      {/* MAP VIEW CONTAINER */}
      <View style={styles.mapContainer}>
        {isWeb ? (
          <FallbackWebMap
            userLocation={userLocation}
            riskZones={MOCK_RISK_ZONES}
            roads={roads}
            graph={INITIAL_ROAD_GRAPH}
            activeRoute={activeRoute}
            volunteers={volunteers}
            selectedVolunteerId={selectedVolunteer?.id}
            onSelectVolunteer={setSelectedVolunteer}
          />
        ) : (
          <DisasterMapView
            userLocation={userLocation}
            riskZones={MOCK_RISK_ZONES}
            roads={roads}
            graph={INITIAL_ROAD_GRAPH}
            activeRoute={activeRoute}
            volunteers={volunteers}
            selectedVolunteerId={selectedVolunteer?.id}
            onSelectVolunteer={setSelectedVolunteer}
          />
        )}
      </View>

      {/* CARDS DISPLAY CONTAINER */}
      <View style={styles.cardsOverlay}>
        <ScrollView
          style={styles.cardsScroll}
          contentContainerStyle={styles.cardsScrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Active Navigation Card */}
          <RouteInfoCard route={activeRoute} />

          {/* Volunteer Match Result Card */}
          {matchResult && (
            <View style={styles.cardSpacing}>
              <MatchResultCard result={matchResult} />
            </View>
          )}
        </ScrollView>
      </View>

      {/* DEMO ACTION CONTROLS */}
      <DemoControlPanel
        roadAStatus={roadAStatus}
        onBlockRoad={handleBlockRoadA}
        onUnblockRoad={handleUnblockRoadA}
        onFindAlternativeRoute={handleFindAlternativeRoute}
        onRequestMedicine={handleRequestMedicine}
        onResetDemo={handleResetDemo}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  header: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  appTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  appSubtitle: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
  riskPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  riskPillText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  cardsOverlay: {
    maxHeight: 240,
    backgroundColor: 'transparent',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  cardsScroll: {
    flexGrow: 0,
  },
  cardsScrollContent: {
    paddingBottom: 4,
  },
  cardSpacing: {
    marginTop: 8,
  },
});
