# Physical-device test checklist (iPhone / Android)

Nothing in this file has been run on real hardware by the developers of this repository. It is the exact procedure for doing so, and the
app has a built-in **Account > Device & connection check** that reports each capability as it is measured on the phone.

## 1. What works where
| Capability | Browser | Expo Go (iPhone/Android) | EAS development / release build |
|---|---|---|---|
| Login, risk, map layers (Leaflet), reports, help, admin | yes (tested in CI-style E2E) | yes (not yet verified) | yes |
| Native map (`react-native-maps`) | n/a (Leaflet) | Apple Maps on iOS, Google Maps on Android (Android Expo Go can show maps; a standalone Android build needs `GOOGLE_MAPS_API_KEY`) | yes |
| GPS | browser geolocation | yes | yes |
| Camera / gallery | file chooser only | yes | yes |
| Secure token storage | localStorage | Keychain/Keystore | Keychain/Keystore |
| **Push notifications** | no | **limited or unavailable in Expo Go** | **yes, needs an EAS build with your project id** |
| Release build server address | `EXPO_PUBLIC_API_URL` | auto-detected from the dev server | **must** set `EXPO_PUBLIC_API_URL` (https) |

## 2. Run it on a phone with Expo Go (same Wi-Fi)
```bash
# computer: backend reachable from the phone (0.0.0.0, not 127.0.0.1)
cd backend && python -m uvicorn main:app --host 0.0.0.0 --port 8000
# computer: app (the app finds http://<your-computer-ip>:8000 from the Expo dev server by itself)
cd mobile && npx expo start
```
Scan the QR code with the phone. If the Device check says the server is unreachable: same Wi-Fi? firewall allowing port 8000? Never use `localhost` on a phone (it means the phone itself); to force an address: `EXPO_PUBLIC_API_URL=http://<computer-ip>:8000 npx expo start`.

## 3. Build for real push and a release test (needs an Expo account)
```bash
cd mobile && eas login && eas init
eas env:create --name EXPO_PUBLIC_API_URL --value https://<your-backend> --environment preview --visibility plaintext
eas build --platform android --profile preview          # installable APK
eas build --platform ios --profile development          # needs an Apple developer account and a registered device
```

## 4. Test script (tick each, note the result)
Open **Account > Device & connection check > Run check**, then **Ask for permissions**, then **Test GPS**.
| # | Test | Expected | Result |
|---|---|---|---|
| 1 | Device check: Server | green, shows latency | |
| 2 | Device check: Location / Camera / Notifications | granted (Notifications warns in Expo Go) | |
| 3 | Test GPS outdoors | a fix with accuracy in metres within 12 s | |
| 4 | Deny location, reopen the app | Home explains and offers "Use Bengaluru instead"; no crash | |
| 5 | Register, log out, log in, kill and reopen the app | session restored (SecureStore) | |
| 6 | Map: toggle every layer, tap a risk cell, a rain area, a hospital | bottom sheet opens with details; no flicker | |
| 7 | Map: Nearest evacuation point | sheet with a designated point and a route | |
| 8 | Report: take a photo, Retake, submit | progress bar, then "Photo uploaded", with the storage line | |
| 9 | Report: airplane mode, submit | clear error, nothing claimed as sent; submit again after reconnecting creates ONE report | |
| 10 | Help: request Medicine with quantity 2; double-tap the button | one request only; timeline shown | |
| 11 | Volunteer account: availability, "Update from my GPS", accept, complete | each step confirms; the requester's timeline updates | |
| 12 | Push (EAS build only): a real alert / volunteer match while the app is closed | notification arrives | |
| 13 | Rotate / small phone / large text setting | no clipped emergency text | |
| 14 | Settings > Reduce Motion on | animations jump to the final state | |

Record the phone model, OS version, build type (Expo Go / development / release) and any failure with a screenshot.
