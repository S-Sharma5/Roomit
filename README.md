# RoomIt — Meeting Room Booking System

An internal meeting room booking tool built with **Next.js 14 (App Router)**, **Node.js / Express**, and **MongoDB**. The system guarantees no double-bookings even under concurrent requests, enforced at the database level.

---

## Live Demo

- **Frontend:** https://roomit-frontend.vercel.app _(deploy to Vercel)_
- **Backend:** https://roomit-api.railway.app _(deploy to Railway/Render)_

---

## Architecture Overview

```
roomit/
├── backend/              # Express API
│   ├── models/
│   │   ├── Room.js       # Room schema
│   │   └── Booking.js    # Booking + SlotLock schemas
│   ├── routes/
│   │   ├── rooms.js      # GET /api/rooms, GET /api/rooms/:id/availability
│   │   └── bookings.js   # POST, GET, PATCH /api/bookings
│   ├── scripts/
│   │   └── seed.js       # Database seeder
│   └── server.js
└── frontend/             # Next.js App Router
    └── app/
        ├── page.js           # Room listing
        ├── rooms/[id]/page.js # Slot grid + booking form
        └── bookings/page.js   # My bookings (lookup, cancel, reschedule)
```

---

## Section 4 Features Implemented

This submission implements **all 5** extended requirements:

| # | Feature | Status |
|---|---------|--------|
| 4.1 | Recurring bookings with partial-conflict handling | ✅ |
| 4.2 | Waitlist with atomic auto-promotion | ✅ |
| 4.3 | Buffer time between bookings | ✅ |
| 4.4 | Reschedule with optimistic locking | ✅ |
| 4.5 | Per-user daily booking quota (4 hrs/day) | ✅ |

---

## Double-Booking Prevention (Section 3.1) — How It Works

**The core problem:** A naïve "check availability, then insert" approach has a race window — two requests can both pass the check before either writes, causing overlapping bookings.

**The solution: `SlotLock` collection with a unique index**

```
SlotLock { key: "roomId|YYYY-MM-DD|HH:MM" }
                         ↑ unique: true
```

Each 30-minute slot is represented as a document with a composite key. When creating a booking:

1. We attempt to `insertMany()` one `SlotLock` doc per requested slot.
2. MongoDB's unique index guarantees **only one insert wins** for any given key, even under concurrent requests — this is atomic at the storage layer.
3. If any insert fails with `E11000` (duplicate key), we:
   - Roll back any locks we _did_ insert (all-or-nothing for multi-slot bookings)
   - Return `409 Conflict` with the conflicting slot(s)
4. On success, we save the `Booking` document.
5. On cancellation, we delete the `SlotLock` docs → slot is immediately available again.

**Why this works under concurrency:** MongoDB's index enforcement happens inside the storage engine's write lock. Two simultaneous inserts of the same key will serialize; one succeeds and one fails with E11000. There's no gap between "check" and "write" — the check _is_ the write.

**Multi-slot atomicity:** We use `insertMany({ ordered: false })` to try all slots, then check for any E11000 errors. If any slot conflicts, we delete all locks we inserted and return a 409. No partial bookings are ever created.

---

## Authentication

Simple email/password auth with JWT, added on top of the original "lookup by email" design (booking lookup/cancel still works by email alone, per the original spec — login just auto-fills the booking form and lets you test as multiple distinct users).

- `POST /api/auth/signup` — create an account, returns a JWT
- `POST /api/auth/login` — returns a JWT
- `GET /api/auth/me` — verify a token, used to restore sessions on page load
- Token is stored in `localStorage` on the frontend and sent as `Authorization: Bearer <token>`
- Passwords are hashed with bcrypt; the JWT secret is `JWT_SECRET` in `backend/.env`

**Seeded test accounts** (after running `npm run seed`), password `password123` for all:
- priya@acme.com
- rahul@acme.com
- aisha@acme.com
- dev@acme.com

To test concurrency/multi-user scenarios, open two browser windows (or one normal + one incognito) and log in as two different seeded accounts, or sign up fresh ones.

## Setup & Running Locally

### Prerequisites
- Node.js 18+
- MongoDB (local or Atlas)

### Backend

```bash
cd backend
cp .env.example .env
# Edit .env: set MONGO_URI
npm install
npm run seed      # Seed rooms + realistic bookings
npm run dev       # Starts on port 5000
```

### Frontend

```bash
cd frontend
cp .env.example .env
# Edit .env: set NEXT_PUBLIC_API_URL=http://localhost:5000
npm install
npm run dev       # Starts on port 3000
```

---

## Environment Variables

### Backend (`backend/.env`)
| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `5000` |
| `MONGO_URI` | MongoDB connection string | `mongodb://localhost:27017/roomit` |
| `FRONTEND_URL` | Allowed CORS origin | `*` |
| `JWT_SECRET` | Secret used to sign JWTs | _(set your own)_ |

### Frontend (`frontend/.env.local`)
| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Backend API URL |

---

## Seed Data

Run `npm run seed` from the backend directory. This creates:

**4 Rooms:**
- Atlas (Floor 2, capacity 10, 10min buffer)
- Meridian (Floor 3, capacity 6)
- Zenith (Floor 1, capacity 20, 10min buffer)
- Nova (Floor 4, capacity 4)

**Test email addresses:**
- `priya@acme.com`
- `rahul@acme.com`
- `aisha@acme.com` ← has a booking starting in ~1hr (non-refundable)
- `dev@acme.com` ← has a booking starting in ~4hrs (refundable)

---

## Concurrency Demo

**Run the double-booking test:**
```bash
node test-concurrency.js http://localhost:5000
```

This fires 5 simultaneous `POST /api/bookings` requests for the same slot and verifies exactly 1 succeeds (201) and the rest get 409.

**Run the daily quota race test (Section 4.5):**
```bash
node test-quota-concurrency.js http://localhost:5000
```
This books a test user up to 3 hours, then fires two simultaneous 1-hour requests. At most one should succeed (3+1+1=5h exceeds the 4h cap).

**Manual curl test:**
```bash
# Fire two requests at the same time (background &)
curl -s -X POST http://localhost:5000/api/bookings \
  -H "Content-Type: application/json" \
  -d '{"roomId":"<id>","date":"2025-08-01","startTime":"10:00","endTime":"10:30","name":"Alice","email":"alice@test.com","title":"Test"}' &

curl -s -X POST http://localhost:5000/api/bookings \
  -H "Content-Type: application/json" \
  -d '{"roomId":"<id>","date":"2025-08-01","startTime":"10:00","endTime":"10:30","name":"Bob","email":"bob@test.com","title":"Test"}' &

wait
```

Expected: one 201, one 409.

---

## API Reference

### Rooms
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/rooms` | List all rooms |
| `GET` | `/api/rooms/:id` | Room details |
| `GET` | `/api/rooms/:id/availability?date=YYYY-MM-DD` | 30-min slot grid |

### Bookings
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/bookings` | Create booking (supports recurring) |
| `GET` | `/api/bookings?email=...` | User's bookings |
| `PATCH` | `/api/bookings/:id/cancel` | Cancel (computes refund server-side) |
| `PATCH` | `/api/bookings/:id/reschedule` | Reschedule with optimistic locking |
| `POST` | `/api/bookings/:id/waitlist` | Join waitlist |

---

## Refund Window Logic (Section 3.2)

Cancellation refund status is computed **server-side** at the moment of cancellation:

```
bookingStart - now >= 2 hours → "cancelled-refundable"
bookingStart - now < 2 hours  → "cancelled-non-refundable"
```

The client cannot supply a timestamp. Slots are freed immediately on cancellation regardless of refund status.

---

## Section 4 Details

### 4.1 Recurring Bookings
- POST `/api/bookings` with `recurring: { enabled: true, weeks: 6, onConflict: "skip"|"abort" }`
- `"skip"`: books all non-conflicting dates, skips conflicts
- `"abort"`: rolls back entire series on any conflict
- Cancellation supports `recurringScope: "this"` or `"this-and-future"`

### 4.2 Waitlist Auto-Promotion
- POST `/api/bookings/:id/waitlist` to join a waitlist
- On cancellation, first waitlisted user is auto-promoted via atomic `findOneAndUpdate` with `$pop`
- **Known gap & mitigation:** the dequeue (`$pop`) and the slot-lock acquisition for the promoted user are two separate operations, not one atomic transaction. If acquisition fails (e.g. quota exceeded, or another request grabbed the freed slot directly), the user is explicitly **re-queued at the front of the list** rather than silently dropped — so they're never lost, though promotion may need a retry on the next cancellation. A stronger fix would wrap pop+insert in a MongoDB multi-document transaction (requires a replica set).

### 4.3 Buffer Time
- Per-room `bufferMinutes` field. Availability grid marks buffer slots as unavailable.

### 4.4 Reschedule with Optimistic Locking
- Sends current `version` field; server rejects with `VERSION_CONFLICT` if it doesn't match.
- Acquires new SlotLock before releasing the old one — no window with 0 or 2 slots held.

### 4.5 Per-User Daily Quota — Atomic Ledger
A naive implementation reads "minutes used today," checks against the cap, then writes the new booking — that's a read-then-write race: two concurrent requests can both read the same total and both pass.

Instead, quota is tracked in a separate `QuotaLedger` collection (one doc per `email|date`), and reservation happens via a **single conditional `findOneAndUpdate`**:

```js
QuotaLedger.findOneAndUpdate(
  { key, minutesUsed: { $lte: 240 - requestedMinutes } },
  { $inc: { minutesUsed: requestedMinutes } },
  { new: true }
)
```

The check (`minutesUsed <= cap - requested`) and the write (`$inc`) happen as one atomic operation. MongoDB serializes writes to a single document, so if two requests race, the second one's filter is evaluated against whatever the first one just wrote — at most one can succeed when both together would exceed the cap. This was verified by hand-tracing the operation sequence (see `test-quota-concurrency.js` for a live concurrency test).

If the booking itself later fails (e.g. slot conflict after quota was reserved), the reserved minutes are released via `releaseQuota()` so a failed booking never silently consumes quota. Cancellation also releases the corresponding minutes.

---

## Design Decisions & Trade-offs

**Why SlotLock instead of MongoDB transactions?**
Transactions require a replica set in MongoDB. SlotLocks work on standalone instances (including Atlas M0 free tier) and have the same atomicity guarantee for this use case since each key insertion is atomic. For production at scale, I'd add transactions as an extra safety net.

**What I'd improve with more time:**
1. Add authentication (JWT) so email isn't the only identity mechanism
2. Rate limiting on the booking endpoint to prevent abuse
3. Websocket push for real-time slot grid updates across browser tabs
4. Email notifications for booking confirmation and waitlist promotion
5. Admin panel for room management

---

## Deployment

### Backend (Railway / Render)
1. Connect GitHub repo, set root to `/backend`
2. Build command: `npm install`
3. Start command: `npm start`
4. Set env vars: `MONGO_URI`, `FRONTEND_URL`

### Frontend (Vercel)
1. Connect GitHub repo, set root to `/frontend`
2. Set env var: `NEXT_PUBLIC_API_URL=https://your-backend.railway.app`
