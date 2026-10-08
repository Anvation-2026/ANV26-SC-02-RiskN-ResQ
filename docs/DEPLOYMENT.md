# Deploying RiskN ResQ

Phones can only reach the app from outside your Wi-Fi once the backend is hosted over HTTPS.

## 1. Backend on Render (free tier works for a demo)
1. Push this repository to GitHub (never `.env`).
2. On https://render.com choose **New > Blueprint** and pick the repo. `render.yaml` creates the API (Docker) and a PostgreSQL database.
3. In the dashboard set `ADMIN_EMAIL` and `ADMIN_PASSWORD` (the Super Admin is created on first start).
4. Optional: `CLOUDINARY_URL` (photos survive restarts), `SMTP_*` (reset and verification emails), `SENTRY_DSN`, `TWILIO_*` (SMS/WhatsApp).
5. Open `https://<your-service>.onrender.com/health`. Render provides HTTPS automatically.

Railway or any VPS works the same way: build `backend/Dockerfile`, set the same variables, set `TRUST_PROXY=1`.

## 2. Point the app at it
A release build has **no** server address unless you give it one: it never falls back to localhost.
```bash
cd mobile && npm install -g eas-cli && eas login && eas init              # writes the EAS project id into app.json (needed for push)
eas env:create --name EXPO_PUBLIC_API_URL --value https://<your-service>.onrender.com --environment preview --visibility plaintext
eas build --platform android --profile preview                              # installable APK (internal distribution)
# iOS needs an Apple developer account:  eas build --platform ios --profile preview
```
For development against a deployed backend: `EXPO_PUBLIC_API_URL=https://<your-service>.onrender.com npx expo start`.
Android release builds refuse plain `http://` backends, so use the HTTPS address Render gives you. Set `CORS_ORIGINS` on the backend to your web address only if you host the web build (phones do not use CORS).

## 3. Push notifications
Remote push needs a development or production build (not Expo Go) with your EAS project id; the backend uses Expo's free push
service and needs no key. Until a device registers a token no push is sent.

## 4. Backups
`DATABASE_URL=... backend/scripts/backup_db.sh` writes a compressed dump and keeps the latest 14. Schedule it daily.

## 5. After deploying
Log in as admin, open **Control**, and use *Import real roads* and *Import hospitals and shelters* once.
