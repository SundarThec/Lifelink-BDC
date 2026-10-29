# LifeLink Pro – Centralized Blood Donation Community Platform

LifeLink is a centralized, real-time web application designed to rapidly connect blood recipients and nearby compatible donors during medical emergencies. It incorporates circular radius spatial matching, an automated ABO/Rh compatibility matrix, real-time WebSocket notifications & emergency coordination chat, and digital donor certification.

---

## 🚀 Quick Start Guide

### Prerequisites
- **Node.js** (v18.x or v20.x recommended)
- **npm** (comes bundled with Node.js)
- **MongoDB** (Optional: local MongoDB service or MongoDB Atlas URI; if MongoDB is not running locally, LifeLink automatically launches an embedded in-memory MongoDB engine for effortless local development).

---

### Step 1: Clone or Open the Project
Open a terminal in the project root directory:
```bash
cd LifeLink-Pro
```

---

### Step 2: Install Dependencies
```bash
npm install
```
*(On Windows PowerShell, if script execution policy restricts `npm`, use `npm.cmd install`)*

---

### Step 3: Environment Configuration
Check or customize `.env` in the root directory. A complete `.env` file is already provided:

```env
PORT=5000
NODE_ENV=development
MONGODB_URI=mongodb://127.0.0.1:27017/lifelink_pro
JWT_SECRET=lifelink_super_secure_jwt_production_secret_key_2026_blood_community
JWT_EXPIRES_IN=7d

# Email Notification Service (SMTP)
# Mode 1: Development/Testing (Default) - leave SMTP_USER empty for Ethereal test emails with in-app web preview:
SMTP_HOST=smtp.ethereal.email
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
EMAIL_FROM="LifeLink Emergency Alerts" <alerts@lifelink.org>

# Mode 2: Real Gmail Delivery - uncomment and supply your Google App Password:
# SMTP_SERVICE=gmail
# SMTP_USER=your_email@gmail.com
# SMTP_PASS=your_16_digit_app_password
```

> **Note:**
> - If `SMTP_USER` is empty, LifeLink automatically runs in **Test Mode with in-app email preview**. Every notification displays an **"Email Sent"** badge with a **"View Email"** button and external Ethereal mailbox link.
> - To deliver emails to real inboxes, simply set `SMTP_SERVICE=gmail` (or your SMTP credentials) and supply your account credentials in `.env`.
> - If `mongodb://127.0.0.1:27017` is not active on your machine, the application will automatically spin up an embedded MongoDB daemon with full spatial `2dsphere` index support.

---

### Step 4: Run the Application

#### Option A: One-Click Run (Windows)
Simply double-click the **`run.bat`** file inside the project directory, or run in terminal:
```bat
run.bat
```
*(This automatically checks Node.js, installs any missing packages, ensures `.env` exists, starts the server, and opens http://localhost:5000 in your browser)*

#### Option B: Standard Terminal Start
```bash
npm start
```
or directly via Node:
```bash
node server/server.js
```
*(On Windows PowerShell, you can also run `npm.cmd start`)*

Once started, access the application in any modern web browser:
👉 **[http://localhost:5000](http://localhost:5000)**

---

### Step 5: Running Verification & Unit Tests
To verify blood compatibility, spatial distance calculations, and MongoDB index handling:
```bash
npm test
```
or directly:
```bash
node test/test.js
```

---

## 🔑 Pre-Configured Test Accounts

The platform automatically seeds initial verified users across different blood groups and coordinates for immediate testing:

| Role / Name | Blood Group | Email / Identifier | Password | Location / Notes |
| :--- | :---: | :--- | :--- | :--- |
| **System Administrator** | `O+` | `admin@lifelink.org` | `Admin@12345` | Bangalore Central (Admin Console access) |
| **Vikram Malhotra** | `O-` | `vikram@example.com` | `Donor@12345` | Universal Donor (Indiranagar) |
| **Ananya Sharma** | `A+` | `ananya@example.com` | `Donor@12345` | Active Donor (Koramangala) |
| **Sarah Jenkins** | `AB+` | `sarah@example.com` | `Donor@12345` | Universal Recipient (Jayanagar) |
| **Rahul Verma** | `B+` | `rahul@example.com` | `Donor@12345` | Regular Donor (Whitefield) |
| **Dr. Priya Nair** | `A-` | `priya@example.com` | `Donor@12345` | Emergency Coordinator (Hebbal) |

---

## 🏗️ Architecture & Features

1. **Strict ABO/Rh Compatibility Engine** (`server/utils/bloodCompatibility.js`):
   - Computes allowed donor blood types mathematically based on blood science (e.g., $O^-$ universal donor, $AB^+$ universal recipient).
2. **True Circular Radius Geospatial Search** (`server/utils/geoDistance.js`):
   - Uses spherical law of cosines / Haversine formula and MongoDB `2dsphere` indexes (`$geoWithin: { $centerSphere: [...] }`) ensuring matching within exact kilometer boundaries.
3. **Real-Time WebSocket Layer** (`Socket.IO`):
   - User-isolated alert channels for targeted notifications.
   - Live room-based chat between recipients and accepting donors.
4. **Digital Certificates of Appreciation**:
   - Automatically generated upon donation completion with verification hashes and print-ready CSS formatting.
5. **Admin Monitoring Console**:
   - Live metrics, inventory analysis, user moderation, emergency requests overview, and dispute management.

---

## 🗺️ Offline Mapping & Local Geocoding (Change 1)

LifeLink Pro operates entirely without internet dependencies for mapping, tile rendering, or geocoding:
- **MapLibre GL JS Client**: Hosted locally under `public/vendor/maplibre-gl/` (zero CDN dependencies).
- **Offline Map Tile Server**: Serves vector/raster map tiles from `/tiles/{z}/{x}/{y}.png` via Express. If a specific tile is not yet pre-rendered on disk, an intelligent offline tile fallback generator serves a neutral offline vector grid tile in real time.
- **Local Gazetteer Geocoding**: Address autocompletion (`GET /api/v1/geocode?q=...`) and reverse geocoding (`GET /api/v1/geocode/reverse?lat=...&lon=...`) are performed locally using `data/gazetteer.geojson` containing major Indian cities, Bangalore localities, and key hospitals. Zero requests are sent to external services like Nominatim or Google Maps.

### Pre-Downloading Tiles for Offline Use
To pre-download offline map tiles for a custom bounding box and zoom range:
```bash
npm run download-tiles
```
Or directly with custom parameters:
```bash
node scripts/download-tiles.js --minZoom=10 --maxZoom=14 --bbox=77.30,12.75,77.85,13.20
```
This stores all tiles locally in `public/tiles/{z}/{x}/{y}.png`.

---

## ⏱️ Automatic Radius Escalation (Change 2)

Emergency blood requests feature an automatic time-based radius escalation engine:
- If a request remains unfilled, the broadcast radius automatically expands according to configurable tiers.
- **Default Escalation Schedule**:
  - `0 min` (on creation): **5 km**
  - `1 hour` elapsed: **10 km**
  - `2 hours` elapsed: **50 km**
- **Configuration**:
  Configured via `.env`:
  ```env
  ESCALATION_TIERS=5:0,10:1,50:2
  ```
  Format: `radiusKm:hoursElapsed,radiusKm:hoursElapsed,...`
- **Duplicate Alert Prevention**: When escalating from $R_{old}$ to $R_{new}$, the escalation engine queries candidate donors with $R \le R_{new}$ and filters out any donors who were already notified, ensuring donors in the new outer ring receive alerts without spamming previous donors.
- **Lifecycle Stop**: When a request is accepted, fulfilled, or cancelled, `nextEscalationAt` is cleared to `null` to immediately cease escalation.
- **Frontend Timeline**: The request modal displays a live escalation progress timeline indicating past escalations and scheduled future expansions.

---

## 🛡️ Enhanced Admin Role & Broadcast Controls (Change 3)

Administrators have comprehensive user moderation and mass broadcast tools:
- **User Management Endpoints** (`/api/v1/admin/users`):
  - `GET /api/v1/admin/users`: List users with real-time filters (blood group, availability, status, search).
  - `PATCH /api/v1/admin/users/:id/block`: Instantly block an account. Blocked users are rejected with HTTP 403 on protected endpoints, disconnected via Socket.IO, and blocked from logging in.
  - `PATCH /api/v1/admin/users/:id/unblock`: Restore account access.
  - `PATCH /api/v1/admin/users/:id/verify`: Mark donor profiles as verified.
  - `DELETE /api/v1/admin/users/:id`: Soft-delete accounts (`isDeleted: true`).
- **Admin Mass Broadcast** (`POST /api/v1/admin/broadcast`):
  - Dispatch announcements, maintenance alerts, or blood drives to all active users or a filtered subset (by blood group, geographical radius, or donor availability).
  - All broadcasts are logged to the `BroadcastLog` collection (`GET /api/v1/admin/broadcast/logs`).
- **Admin Dashboard UI**: Integrated "Users", "Broadcast", and "Broadcast Log" tabs with real-time search, status filtering, and one-click moderation.

---

## 🗄️ Database Migration Notes

Existing MongoDB databases receive backward-compatible schema updates without requiring destructive migrations:

1. **`User` Collection**:
   - `isBlocked` (`Boolean`, default: `false`, indexed): Tracks blocked status.
   - `isVerified` (`Boolean`, default: `false`, indexed): Tracks donor verification status.
   - `isDeleted` (`Boolean`, default: `false`, indexed): Tracks soft-deleted status.
   *Existing records automatically evaluate to `false` for these fields.*

2. **`BloodRequest` Collection**:
   - `radiusHistory` (`Array` of `{ radiusKm: Number, triggeredAt: Date, donorsNotified: Number }`): Audit trail of radius expansions.
   - `nextEscalationAt` (`Date`, default: `null`, indexed): Next scheduled escalation time for active requests.
   *Existing active requests can be updated or will continue with their current `searchRadiusKm`.*

3. **`BroadcastLog` Collection (New)**:
   - Schema:
     - `senderId`: `ObjectId` referencing `User` (Admin).
     - `title`: `String` (required).
     - `message`: `String` (required).
     - `targetCriteria`: `{ bloodGroups: [String], region: { center: [Number], radiusKm: Number }, availableOnly: Boolean }`.
     - `recipientCount`: `Number`.
     - `sentAt`: `Date` (default: `Date.now`).

---

## 🛠️ Troubleshooting

- **PowerShell Execution Policy Error (`npm.ps1 cannot be loaded`)**:
  - Run with `npm.cmd start` or `node server/server.js`.
- **Port 5000 in use**:
  - Update `PORT=5001` (or any available port) in `.env` and restart.
