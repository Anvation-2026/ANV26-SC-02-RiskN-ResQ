# Demo script (8-10 minutes)

Use three windows or phones: **user**, **volunteer**, **admin**. Before you start: backend running with real data (`python scripts/refresh_intelligence.py` once), an admin has imported roads and hospitals/shelters (Admin > Control > *Real map data*), and a volunteer exists (Admin > People). Anything marked *drill* is a labelled simulation.

| Min | Window | Do | Say |
|---|---|---|---|
| 0:00 | User | Open the app, allow location, **Home** | "Real weather from Open-Meteo, cached by our backend. Phones never call weather services." Open **Why this risk?**: every signal has its source and age; unavailable signals are listed, not guessed. |
| 1:30 | User | **Map**: toggle Flood risk, Rainfall, Satellite, Hotspots, Road risk, Terrain; tap the purple satellite cell | "Sentinel-1 radar compared with earlier passes on the same orbit. This is possible ponding, not a confirmed flood." Tap a risk cell for the explanation. |
| 3:00 | User | **Nearest evacuation point** | "A *designated* point from OpenStreetMap, with a risk-aware route. We never call a place safe." |
| 3:45 | Admin | **Control > Guided demo**: step 2 *Simulate heavy rain (80 mm)* | "Clearly labelled SIMULATED DRILL; it never overwrites real observations or notifies anyone." |
| 4:30 | User | **Home / Alerts** (updates on its own) | HIGH risk with reason, sources, probability (prototype estimate), recommended action, SIMULATED tag. |
| 5:15 | Admin | Step 3 *Block a road* | Road turns red on every map; "potentially affected" roads are orange, only evidence blocks a road. |
| 5:45 | User | **Map > Corridor & Response** | Alternative route avoids the blocked road; wording: "Recommended ... based on current environmental and incident data." |
| 6:30 | User | **Report** a flood with a photo; then **Help**: request Medicine | One report does not declare a flood; it is checked against rain/satellite/terrain. The nearest volunteer is matched. |
| 7:15 | Volunteer | **Requests** > View details > Accept > Mark completed | User sees status, ETA and timeline update. |
| 8:15 | Admin | **Incidents** (verify; confidence breakdown), **Intelligence** (provider freshness, zone explanations, positioning suggestion), **Insights** (charts, **Export CSV**, audit log) | "Transparent data freshness: weather, satellite, terrain; river gauges honestly not connected." |
| 9:30 | Admin | Step 5 *Reset the demo* | Accounts stay; runtime state clears. Close with `docs/CLAIMS_AND_LIMITS.md`: what is real, prototype, simulated, and not verified on hardware. |

If a data provider is down during the demo, the app says "... unavailable" or "STALE DATA" and carries on with the remaining signals; use the drill for the rainfall step and say so.
