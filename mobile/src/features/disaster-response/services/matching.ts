/**
 * matching.ts
 * Multi-criteria deterministic volunteer and resource matching engine.
 */

import {
  HelpRequest,
  HelpRequestPriority,
  MatchResult,
  MatchScoreBreakdown,
  Volunteer,
} from '../types/types';
import { calculateDistanceKm } from '../utils/distance';

/**
 * Calculates distance sub-score (0 to 20 points).
 * Decreases proportionally with distance according to emergency triage thresholds:
 * - 0 - 1 km: up to 20 points (e.g. 0.8 km -> 12 points)
 * - 1 - 2 km: 10 to 15 points
 * - 2 - 5 km: 5 to 10 points
 * - 5+ km: 0 points
 */
export function calculateDistanceScore(distanceKm: number): number {
  if (distanceKm <= 1.0) {
    // Linear decay within first kilometer (20 at 0km down to 10 at 1km; at 0.8km = 12 pts)
    return Math.max(10, Math.round(20 - distanceKm * 10));
  }
  if (distanceKm <= 2.0) {
    // 15 down to 10 points
    return Math.max(10, Math.round(15 - (distanceKm - 1.0) * 5));
  }
  if (distanceKm <= 5.0) {
    // 10 down to 2 points
    return Math.max(2, Math.round(10 - ((distanceKm - 2.0) / 3.0) * 8));
  }
  return 0;
}

/**
 * Calculates priority suitability sub-score (0 to 10 points).
 */
export function calculatePriorityScore(priority: HelpRequestPriority): number {
  switch (priority) {
    case 'CRITICAL':
    case 'HIGH':
      return 10;
    case 'MEDIUM':
      return 7;
    case 'LOW':
    default:
      return 5;
  }
}

/**
 * Evaluates and ranks candidate volunteers against a help request.
 *
 * Algorithm Steps:
 * 1. Filter by requested resource
 * 2. Filter by availability
 * 3. Calculate distance using Haversine
 * 4. Compute composite match score (Max 100)
 * 5. Rank and return top candidate
 *
 * @param helpRequest - The incoming civilian or dispatcher assistance request
 * @param volunteers - Roster of community volunteers and supplies
 * @returns MatchResult conforming to the RiskNResQ contract
 */
export function findBestVolunteerMatch(
  helpRequest: HelpRequest,
  volunteers: Volunteer[]
): MatchResult {
  const normalizedRequestedResource = helpRequest.resource.trim().toLowerCase();

  // STEP 1 & 2: Filter by resource compatibility and availability
  const eligibleVolunteers = volunteers.filter((vol) => {
    const resourceMatches = vol.resource.trim().toLowerCase() === normalizedRequestedResource;
    const isAvailable = vol.availability === 'AVAILABLE';
    return resourceMatches && isAvailable;
  });

  if (eligibleVolunteers.length === 0) {
    return {
      matched: false,
      message: 'No suitable nearby resource found.',
    };
  }

  // STEP 3 & 4: Calculate distances and scores
  const scoredCandidates = eligibleVolunteers.map((volunteer) => {
    const distanceKm = calculateDistanceKm(
      helpRequest.latitude,
      helpRequest.longitude,
      volunteer.latitude,
      volunteer.longitude
    );

    const resourceCompatibility = 50;
    const availabilityScore = 20;
    const distanceScore = calculateDistanceScore(distanceKm);
    const priorityScore = calculatePriorityScore(helpRequest.priority);

    const totalScore = Math.min(
      100,
      resourceCompatibility + availabilityScore + distanceScore + priorityScore
    );

    const breakdown: MatchScoreBreakdown = {
      resourceCompatibility,
      availabilityScore,
      distanceScore,
      priorityScore,
      totalScore,
    };

    return {
      volunteer,
      distanceKm,
      matchScore: totalScore,
      breakdown,
    };
  });

  // STEP 5: Rank by matchScore descending, then distance ascending as tiebreaker
  scoredCandidates.sort((a, b) => {
    if (b.matchScore !== a.matchScore) {
      return b.matchScore - a.matchScore;
    }
    return a.distanceKm - b.distanceKm;
  });

  const bestMatch = scoredCandidates[0];

  return {
    matched: true,
    volunteer: {
      id: bestMatch.volunteer.id,
      name: bestMatch.volunteer.name,
      latitude: bestMatch.volunteer.latitude,
      longitude: bestMatch.volunteer.longitude,
      phone: bestMatch.volunteer.phone,
    },
    resource: bestMatch.volunteer.resource,
    distanceKm: bestMatch.distanceKm,
    matchScore: bestMatch.matchScore,
    scoreBreakdown: bestMatch.breakdown,
  };
}
