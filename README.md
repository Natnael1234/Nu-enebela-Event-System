# SaNex Realities - NU ENEBLA Queue System

Fast event queue and payment verification system for VR/MR game sessions.

## Features

- Player registration with:
  - Full name
  - Phone number
  - Telegram
  - Game selection
- Payment flow:
  - Shows Telebirr and CBE accounts
  - Screenshot upload by player
  - Admin approval/rejection
- Queue management:
  - Queue number assigned only after payment approval
  - Live queue tracking for players
  - Admin controls `start next`, `complete current`, and `mark missed`
  - Fair missed-turn mechanism (`missed_waiting` pool inserted periodically)
- Admin capabilities:
  - Sign up / sign in
  - Payment verification
  - Game management (name, description, image, video)
  - Score updates and gameplay media uploads
  - Finance dashboard
- Public display page:
  - Current player
  - Next queue list
  - Leaderboard

## Tech Stack

- Backend: Node.js + Express
- Storage: JSON (`data/db.json`)
- Uploads: Local folders (`uploads/`)
- Frontend: Lightweight HTML/CSS/Vanilla JS (very fast initial load)

## Setup

1. Install dependencies:
   - `npm install`
2. Run server:
   - `npm start`
3. Open:
   - Client: `http://localhost:3000/`
   - Admin: `http://localhost:3000/admin.html`
   - Display: `http://localhost:3000/display.html`

## Default Business Rules

- Ticket price: **200 Birr**
- One queue booking = one person
- Only one active booking per person at a time
- Queue number assigned after payment proof approval

## Finance Management

Finance endpoint computes:

- Approved bookings count
- Completed sessions count
- Pending reviews
- Rejected payments
- Gross revenue:
  - `approved_bookings * 200`
- Revenue per game

## Use Cases

### Client

- Register booking
- Upload payment screenshot
- Track queue and readiness message
- View score and gameplay media after session

### Admin

- Sign up / sign in
- Verify payment screenshots
- Assign queue (via approval)
- Control live queue flow
- Manage games and content
- Attach gameplay media and scores
- Monitor revenue

### Display Screen

- Show now playing player
- Show next players in queue
- Show leaderboard top scores

## API Overview

### Public

- `GET /api/games`
- `GET /api/payment-methods`
- `GET /api/leaderboard`
- `GET /api/display/current`
- `GET /api/queue/overview`

### Client

- `POST /api/client/register`
- `POST /api/client/login`
- `GET /api/client/me`
- `POST /api/client/bookings/:bookingId/payment-proof`

### Admin

- `POST /api/admin/auth/signup`
- `POST /api/admin/auth/login`
- `GET /api/admin/me`
- `GET /api/admin/pending-payments`
- `POST /api/admin/bookings/:bookingId/approve`
- `POST /api/admin/bookings/:bookingId/reject`
- `GET /api/admin/queue`
- `POST /api/admin/queue/start-next`
- `POST /api/admin/queue/complete-current`
- `POST /api/admin/queue/mark-missed-current`
- `POST /api/admin/bookings/:bookingId/score`
- `POST /api/admin/bookings/:bookingId/gameplay-media`
- `POST /api/admin/games`
- `PUT /api/admin/games/:gameId`
- `DELETE /api/admin/games/:gameId`
- `GET /api/admin/bookings`
- `GET /api/admin/finance`

## Marketing Recommendations (No Discount)

- Team slot booking (same per-person price)
- Corporate challenge blocks with consecutive slots
- Leaderboard contests with sponsor prizes
- Fast-lane booking windows for partner communities
- Social clip spotlight package (post-session media)

## Performance Notes

- Minimal frontend bundle (no heavy UI framework)
- Static assets served directly by Express
- Local JSON operations for very low overhead at event scale
- Polling updates every few seconds for low complexity and stable performance

---

If this grows after NU ENEBLA, migrate JSON storage to PostgreSQL with the same API contract.
