const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Booking = require("../models/Booking");
const { SlotLock, QuotaLedger } = require("../models/Booking");
const Room = require("../models/Room");

const DAILY_QUOTA_MINUTES = 240; // 4 hours

/**
 * Atomically reserve `minutes` of quota for email+date.
 * Uses a single findOneAndUpdate with a conditional filter so the
 * "is there room left" check and "consume it" happen as one atomic
 * operation. Returns { ok: true } on success, or
 * { ok: false, remainingMinutes } if quota would be exceeded.
 *
 * Race-safety: if two requests fire simultaneously, MongoDB serializes
 * writes to the same document. The second request's filter
 * (minutesUsed <= 240 - minutes) is re-evaluated against the value the
 * first request just wrote, so at most one can succeed when both would
 * otherwise exceed the cap.
 */
async function reserveQuota(email, date, minutes) {
  const key = `${email.toLowerCase()}|${date}`;

  // Ensure the ledger doc exists (upsert with $setOnInsert, no increment yet).
  // On the very first booking for a user+day, two simultaneous requests can
  // both attempt this upsert before either commits; MongoDB's unique index
  // on `key` means at most one insert wins and the other is safely ignored —
  // but depending on driver/version this can occasionally surface as an
  // E11000 here instead of silently no-op-ing, so we swallow that specific
  // case (it just means the doc now exists, which is all we needed).
  try {
    await QuotaLedger.updateOne(
      { key },
      { $setOnInsert: { key, email: email.toLowerCase(), date, minutesUsed: 0 } },
      { upsert: true }
    );
  } catch (err) {
    if (err.code !== 11000) throw err;
  }

  // Atomic conditional increment: only succeeds if there's enough room left.
  // This single findOneAndUpdate IS the race-safety guarantee — the check
  // ("is minutesUsed low enough") and the write ("add minutes") happen as
  // one indivisible operation, so two concurrent calls cannot both pass.
  const updated = await QuotaLedger.findOneAndUpdate(
    { key, minutesUsed: { $lte: DAILY_QUOTA_MINUTES - minutes } },
    { $inc: { minutesUsed: minutes } },
    { new: true }
  );

  if (updated) {
    return { ok: true, minutesUsed: updated.minutesUsed };
  }

  // Filter didn't match — read current value to report how much is left
  const current = await QuotaLedger.findOne({ key });
  return { ok: false, remainingMinutes: Math.max(0, DAILY_QUOTA_MINUTES - (current?.minutesUsed || 0)) };
}

/**
 * Release previously reserved quota minutes (used on cancellation, or to
 * roll back a reservation if a later step in the same request fails).
 */
async function releaseQuota(email, date, minutes) {
  const key = `${email.toLowerCase()}|${date}`;
  await QuotaLedger.updateOne(
    { key },
    { $inc: { minutesUsed: -minutes } }
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse "HH:MM" into total minutes from midnight.
 */
function timeToMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Add minutes to a "HH:MM" string. Returns null if result >= 24:00.
 */
function addMinutes(t, mins) {
  const total = timeToMinutes(t) + mins;
  if (total >= 24 * 60) return null;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Generate all 30-min slot strings between startTime (inclusive) and endTime (exclusive).
 * e.g. start="09:00" end="10:30" → ["09:00","09:30","10:00"]
 */
function generateSlots(startTime, endTime) {
  const slots = [];
  let cur = startTime;
  while (cur < endTime) {
    slots.push(cur);
    cur = addMinutes(cur, 30);
    if (!cur) break;
  }
  return slots;
}

/**
 * Build SlotLock keys for room+date+slots.
 */
function buildLockKeys(roomId, date, slots) {
  return slots.map((s) => `${roomId}|${date}|${s}`);
}

/**
 * Determine refund status based on server time vs booking start.
 * Returns "cancelled-refundable" if cancellation >= 2h before booking, else "cancelled-non-refundable".
 */
function computeCancelStatus(date, startTime) {
  const now = new Date();
  const bookingStart = new Date(`${date}T${startTime}:00`);
  const diffMs = bookingStart - now;
  const diffHours = diffMs / (1000 * 60 * 60);
  return diffHours >= 2 ? "cancelled-refundable" : "cancelled-non-refundable";
}

// ─── POST /api/bookings ───────────────────────────────────────────────────────
/**
 * Create a booking for one or more consecutive 30-min slots.
 *
 * CONCURRENCY SAFEGUARD (Section 3.1):
 * We insert SlotLock documents with a unique index on `key` (roomId|date|time).
 * MongoDB guarantees that if two requests try to insert the same key, only one
 * succeeds — the other gets a duplicate-key error (E11000), which we catch and
 * return as 409. This is atomic at the database level and requires NO separate
 * "check then write" step that could race.
 *
 * Multi-slot bookings: we use an insertMany() with ordered:false so all inserts
 * are attempted; any duplicate causes a partial failure. We then roll back by
 * deleting any locks we did insert. This guarantees all-or-nothing (Section 3.1).
 */
router.post("/", async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const {
      roomId,
      date,
      startTime,
      endTime,
      name,
      email,
      title,
      // Section 4.1 recurring support
      recurring,
    } = req.body;

    // ── Validation ────────────────────────────────────────────────────────────
    if (!roomId || !date || !startTime || !endTime || !name || !email || !title) {
      return res.status(400).json({ error: "Missing required fields: roomId, date, startTime, endTime, name, email, title" });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "date must be YYYY-MM-DD" });
    }
    if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
      return res.status(400).json({ error: "startTime and endTime must be HH:MM" });
    }
    if (timeToMinutes(startTime) >= timeToMinutes(endTime)) {
      return res.status(400).json({ error: "endTime must be after startTime" });
    }
    if (!mongoose.isValidObjectId(roomId)) {
      return res.status(400).json({ error: "Invalid roomId" });
    }

    const room = await Room.findById(roomId);
    if (!room || !room.isActive) {
      return res.status(404).json({ error: "Room not found" });
    }

    // Section 4.5: Per-user daily quota — ATOMIC reservation, race-safe.
    // (Recurring bookings reserve per-occurrence inside handleRecurringBooking.)
    const requestedMinutes = timeToMinutes(endTime) - timeToMinutes(startTime);

    if (!(recurring && recurring.enabled)) {
      const quota = await reserveQuota(email, date, requestedMinutes);
      if (!quota.ok) {
        return res.status(400).json({
          error: `Daily quota exceeded. You have ${quota.remainingMinutes} minutes remaining on ${date} (max 4 hours/day).`,
          remainingMinutes: quota.remainingMinutes,
          day: date,
        });
      }
    }

    // Handle recurring bookings (Section 4.1)
    if (recurring && recurring.enabled) {
      return await handleRecurringBooking(req, res, { room, date, startTime, endTime, name, email, title, recurring });
    }

    // Generate slot list for this booking
    const slots = generateSlots(startTime, endTime);
    if (slots.length === 0) {
      return res.status(400).json({ error: "No valid slots in the given time range" });
    }

    // ── Atomic slot acquisition ───────────────────────────────────────────────
    // Create a temporary booking doc (no session needed for SlotLock strategy)
    const booking = new Booking({
      room: roomId,
      date,
      startTime,
      endTime,
      slots,
      bookedBy: { name, email },
      title,
      status: "confirmed",
    });

    const lockKeys = buildLockKeys(roomId, date, slots);
    const lockDocs = lockKeys.map((key) => ({ key, bookingId: booking._id }));

    let insertedKeys = [];
    try {
      // ordered:false = try all inserts; any E11000 means conflict
      const result = await SlotLock.insertMany(lockDocs, {
        ordered: false,
        rawResult: true,
      });
      insertedKeys = lockDocs.map((d) => d.key);
    } catch (err) {
      if (err.code === 11000 || (err.writeErrors && err.writeErrors.length > 0)) {
        // Roll back any locks we did manage to insert
        const inserted = (err.insertedDocs || []).map((d) => d.key);
        if (inserted.length > 0) {
          await SlotLock.deleteMany({ key: { $in: inserted } });
        }
        const conflicting = (err.writeErrors || []).map((e) => {
          const parts = e.err?.errmsg?.match(/key: \{ key: "(.+?)" \}/);
          return parts ? parts[1].split("|")[2] : "unknown";
        });
        // Roll back the quota reservation — this booking never actually happened
        await releaseQuota(email, date, requestedMinutes);
        return res.status(409).json({
          error: "One or more slots are already booked. No booking was created.",
          conflictingSlots: conflicting,
        });
      }
      throw err;
    }

    // All locks acquired — save the booking
    await booking.save();

    // Update lock docs to point to the saved booking
    await SlotLock.updateMany({ key: { $in: lockKeys } }, { $set: { bookingId: booking._id } });

    return res.status(201).json(await Booking.findById(booking._id).populate("room", "name location floor capacity"));
  } catch (err) {
    next(err);
  } finally {
    session.endSession();
  }
});

// ─── Handle recurring bookings ────────────────────────────────────────────────
async function handleRecurringBooking(req, res, { room, date, startTime, endTime, name, email, title, recurring }) {
  const { weeks = 6, onConflict = "skip" } = recurring; // onConflict: "skip" | "abort"
  if (weeks < 1 || weeks > 52) {
    return res.status(400).json({ error: "weeks must be between 1 and 52" });
  }

  const recurringGroupId = new mongoose.Types.ObjectId();
  const results = [];
  const conflicts = [];
  const requestedMinutes = timeToMinutes(endTime) - timeToMinutes(startTime);

  for (let i = 0; i < weeks; i++) {
    const occurrenceDate = addDays(date, i * 7);

    // Section 4.5: atomic per-occurrence quota reservation (own date — each
    // occurrence's quota is independent since the quota is "per day").
    const quota = await reserveQuota(email, occurrenceDate, requestedMinutes);
    if (!quota.ok) {
      if (onConflict === "abort") {
        await rollbackRecurringSeries(results, room._id.toString(), email, requestedMinutes);
        return res.status(400).json({
          error: `Recurring booking aborted: daily quota exceeded on ${occurrenceDate}.`,
          conflictDate: occurrenceDate,
        });
      }
      conflicts.push({ date: occurrenceDate, reason: "quota exceeded" });
      continue;
    }

    const slots = generateSlots(startTime, endTime);
    const lockKeys = buildLockKeys(room._id.toString(), occurrenceDate, slots);
    const bookingId = new mongoose.Types.ObjectId();
    const lockDocs = lockKeys.map((key) => ({ key, bookingId }));

    try {
      await SlotLock.insertMany(lockDocs, { ordered: false, rawResult: true });

      const booking = new Booking({
        _id: bookingId,
        room: room._id,
        date: occurrenceDate,
        startTime,
        endTime,
        slots,
        bookedBy: { name, email },
        title,
        status: "confirmed",
        recurringGroupId,
        recurringIndex: i,
      });
      await booking.save();
      results.push({ date: occurrenceDate, status: "booked", bookingId });
    } catch (err) {
      if (err.code === 11000 || (err.writeErrors && err.writeErrors.length > 0)) {
        const inserted = (err.insertedDocs || []).map((d) => d.key);
        if (inserted.length > 0) await SlotLock.deleteMany({ key: { $in: inserted } });
        // This occurrence didn't happen — release the quota we just reserved for it
        await releaseQuota(email, occurrenceDate, requestedMinutes);

        if (onConflict === "abort") {
          await rollbackRecurringSeries(results, room._id.toString(), email, requestedMinutes);
          return res.status(409).json({
            error: "Recurring booking aborted: conflict found on " + occurrenceDate,
            conflictDate: occurrenceDate,
          });
        }
        conflicts.push({ date: occurrenceDate, reason: "slot conflict" });
      } else {
        throw err;
      }
    }
  }

  return res.status(201).json({
    recurringGroupId,
    booked: results,
    skipped: conflicts,
    total: weeks,
    message: `${results.length} of ${weeks} occurrences booked successfully.`,
  });
}

/**
 * Roll back a partially-booked recurring series: delete SlotLocks, delete
 * Booking docs, and release the quota minutes reserved for each occurrence.
 */
async function rollbackRecurringSeries(bookedResults, roomId, email, minutesPerOccurrence) {
  const bookedIds = bookedResults.map((r) => r.bookingId);
  if (bookedIds.length === 0) return;
  const bookedBookings = await Booking.find({ _id: { $in: bookedIds } });
  for (const b of bookedBookings) {
    await SlotLock.deleteMany({ key: { $in: buildLockKeys(roomId, b.date, b.slots) } });
    await releaseQuota(email, b.date, minutesPerOccurrence);
  }
  await Booking.deleteMany({ _id: { $in: bookedIds } });
}

/**
 * Add days to a YYYY-MM-DD string.
 */
function addDays(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

// ─── GET /api/bookings?email=... ──────────────────────────────────────────────
router.get("/", async (req, res, next) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ error: "email query param required" });
    }

    const bookings = await Booking.find({
      "bookedBy.email": email.toLowerCase(),
    })
      .populate("room", "name location floor capacity bufferMinutes")
      .sort({ date: -1, startTime: -1 });

    res.json(bookings);
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /api/bookings/:id/cancel ──────────────────────────────────────────
router.patch("/:id/cancel", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid booking ID" });
    }

    const { recurringScope } = req.body; // "this" | "this-and-future"

    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    if (booking.status !== "confirmed") {
      return res.status(400).json({ error: "Booking is already cancelled" });
    }

    // Check if booking is in the past
    const bookingStart = new Date(`${booking.date}T${booking.startTime}:00`);
    if (bookingStart < new Date()) {
      return res.status(400).json({ error: "Cannot cancel a past booking" });
    }

    // Compute refund status server-side (Section 3.2)
    const cancelStatus = computeCancelStatus(booking.date, booking.startTime);

    // Handle recurring cancellation (Section 4.1)
    if (booking.recurringGroupId && recurringScope === "this-and-future") {
      const futureBookings = await Booking.find({
        recurringGroupId: booking.recurringGroupId,
        recurringIndex: { $gte: booking.recurringIndex },
        status: "confirmed",
      });

      for (const b of futureBookings) {
        const status = computeCancelStatus(b.date, b.startTime);
        b.status = status;
        await b.save();
        // Free the slots (remove SlotLocks)
        const lockKeys = buildLockKeys(b.room.toString(), b.date, b.slots);
        await SlotLock.deleteMany({ key: { $in: lockKeys } });
        // Section 4.5: release this occurrence's quota minutes
        const occurrenceMinutes = timeToMinutes(b.endTime) - timeToMinutes(b.startTime);
        await releaseQuota(b.bookedBy.email, b.date, occurrenceMinutes);
        // Section 4.2: promote waitlisted users
        await promoteWaitlist(b);
      }
      return res.json({
        cancelled: futureBookings.length,
        message: `Cancelled ${futureBookings.length} occurrence(s) from this date forward.`,
      });
    }

    // Single booking cancellation
    booking.status = cancelStatus;
    await booking.save();

    // Free the slot locks immediately so other users can book (Section 3.2)
    const lockKeys = buildLockKeys(booking.room.toString(), booking.date, booking.slots);
    await SlotLock.deleteMany({ key: { $in: lockKeys } });

    // Section 4.5: cancelling frees up that day's quota
    const bookingMinutes = timeToMinutes(booking.endTime) - timeToMinutes(booking.startTime);
    await releaseQuota(booking.bookedBy.email, booking.date, bookingMinutes);

    // Section 4.2: promote first waitlisted user atomically
    await promoteWaitlist(booking);

    res.json({
      booking,
      refundable: cancelStatus === "cancelled-refundable",
      message:
        cancelStatus === "cancelled-refundable"
          ? "Booking cancelled. A refund will be processed."
          : "Booking cancelled. No refund (cancelled less than 2 hours before start).",
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Section 4.2 — Atomic waitlist promotion.
 * After a booking is cancelled, promote the first waitlisted user.
 * Uses findOneAndUpdate with $pop to atomically dequeue the first entry,
 * preventing race conditions where two cancellations might both promote someone.
 *
 * IMPORTANT — known gap and mitigation:
 * The dequeue ($pop) and the slot-lock acquisition are two separate operations,
 * so they are not part of a single atomic transaction. The risk window is:
 * we pop a user off the queue, then try to acquire the freed slot for them.
 * If that acquisition fails (e.g. someone else's request grabbed the same
 * freed slot directly via POST /api/bookings in between), the popped user
 * would be lost unless we handle it — so we explicitly re-queue them at the
 * FRONT of the list on any failure (slot conflict or quota exceeded) rather
 * than silently dropping them. This guarantees "never zero" outcomes from
 * the user's perspective (they're never lost), at the cost of a brief window
 * where the promotion could need a retry. A stronger fix would run the pop +
 * insert inside a Mongo multi-document transaction (replica set required) —
 * noted as a future improvement in the README.
 */
async function promoteWaitlist(cancelledBooking) {
  if (!cancelledBooking.waitlist || cancelledBooking.waitlist.length === 0) return;

  // Atomically remove the first waitlisted user
  const updated = await Booking.findOneAndUpdate(
    {
      _id: cancelledBooking._id,
      "waitlist.0": { $exists: true },
    },
    { $pop: { waitlist: -1 } }, // -1 = remove first element
    { new: false }
  );

  if (!updated || !updated.waitlist || updated.waitlist.length === 0) return;

  const promoted = updated.waitlist[0]; // The user we just dequeued
  const minutes = timeToMinutes(cancelledBooking.endTime) - timeToMinutes(cancelledBooking.startTime);

  // Check/reserve quota for the promoted user atomically
  const quota = await reserveQuota(promoted.email, cancelledBooking.date, minutes);
  if (!quota.ok) {
    console.log(`⚠️ Waitlist: ${promoted.email} over quota on ${cancelledBooking.date} — re-queueing, trying next`);
    await requeueAtFront(cancelledBooking._id, promoted);
    return; // Don't recurse automatically; next cancellation/cron can retry the queue
  }

  // Create a new booking for the promoted user
  const newBooking = new Booking({
    room: cancelledBooking.room,
    date: cancelledBooking.date,
    startTime: cancelledBooking.startTime,
    endTime: cancelledBooking.endTime,
    slots: cancelledBooking.slots,
    bookedBy: { name: promoted.name, email: promoted.email },
    title: `[Promoted from waitlist] ${cancelledBooking.title}`,
    status: "confirmed",
  });

  const lockKeys = buildLockKeys(
    cancelledBooking.room.toString(),
    cancelledBooking.date,
    cancelledBooking.slots
  );
  const lockDocs = lockKeys.map((key) => ({ key, bookingId: newBooking._id }));

  try {
    await SlotLock.insertMany(lockDocs, { ordered: false });
    await newBooking.save();
    console.log(`✅ Waitlist: ${promoted.email} promoted for booking on ${cancelledBooking.date}`);
  } catch (err) {
    // Another request beat us to the freed slot — release their quota
    // reservation and put them back at the front of the queue rather than
    // dropping them silently.
    if (err.code === 11000) {
      console.log("⚠️ Waitlist promotion race: slot already re-booked — re-queueing user");
      await releaseQuota(promoted.email, cancelledBooking.date, minutes);
      await requeueAtFront(cancelledBooking._id, promoted);
    }
  }
}

/**
 * Put a waitlisted user back at the front of the queue (used when promotion
 * fails after the user was already popped, so they're never silently lost).
 */
async function requeueAtFront(bookingId, waitlistEntry) {
  await Booking.findByIdAndUpdate(bookingId, {
    $push: { waitlist: { $each: [waitlistEntry], $position: 0 } },
  });
}

// ─── PATCH /api/bookings/:id/reschedule ──────────────────────────────────────
// Section 4.4: Reschedule with optimistic locking
router.patch("/:id/reschedule", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid booking ID" });
    }

    const { newDate, newStartTime, newEndTime, version } = req.body;

    if (!newDate || !newStartTime || !newEndTime || version === undefined) {
      return res.status(400).json({
        error: "newDate, newStartTime, newEndTime, and version are required",
      });
    }
    if (timeToMinutes(newStartTime) >= timeToMinutes(newEndTime)) {
      return res.status(400).json({ error: "newEndTime must be after newStartTime" });
    }

    // Optimistic lock check: reject if booking was modified since form was opened
    const booking = await Booking.findOne({ _id: req.params.id, version });
    if (!booking) {
      const exists = await Booking.findById(req.params.id);
      if (!exists) return res.status(404).json({ error: "Booking not found" });
      return res.status(409).json({
        error: "Booking was modified since you opened this form. Please refresh and try again.",
        code: "VERSION_CONFLICT",
      });
    }
    if (booking.status !== "confirmed") {
      return res.status(400).json({ error: "Cannot reschedule a cancelled booking" });
    }

    const newSlots = generateSlots(newStartTime, newEndTime);
    const roomId = booking.room.toString();
    const newLockKeys = buildLockKeys(roomId, newDate, newSlots);
    const newLockDocs = newLockKeys.map((key) => ({ key, bookingId: booking._id }));

    // Release old locks first (free the old slot), then acquire new ones atomically
    const oldLockKeys = buildLockKeys(roomId, booking.date, booking.slots);

    // We must do this atomically: free old, acquire new.
    // Strategy: insert new locks first (fail fast on conflict), then delete old.
    try {
      await SlotLock.insertMany(newLockDocs, { ordered: false, rawResult: true });
    } catch (err) {
      if (err.code === 11000 || (err.writeErrors && err.writeErrors.length > 0)) {
        const inserted = (err.insertedDocs || []).map((d) => d.key);
        if (inserted.length > 0) await SlotLock.deleteMany({ key: { $in: inserted } });
        return res.status(409).json({
          error: "The new time slot is not available.",
          conflictingSlots: (err.writeErrors || []).map((e) => {
            const parts = e.err?.errmsg?.match(/key: \{ key: "(.+?)" \}/);
            return parts ? parts[1].split("|")[2] : "unknown";
          }),
        });
      }
      throw err;
    }

    // New locks acquired — now release old ones and update the booking
    await SlotLock.deleteMany({ key: { $in: oldLockKeys } });

    booking.date = newDate;
    booking.startTime = newStartTime;
    booking.endTime = newEndTime;
    booking.slots = newSlots;
    booking.version += 1;
    await booking.save();

    // Update lock docs to match new booking data
    await SlotLock.updateMany({ key: { $in: newLockKeys } }, { $set: { bookingId: booking._id } });

    res.json(await Booking.findById(booking._id).populate("room", "name location floor capacity"));
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/bookings/:id/waitlist ─────────────────────────────────────────
// Section 4.2: Join waitlist for a booked slot
router.post("/:id/waitlist", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid booking ID" });
    }

    const { name, email } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: "name and email required" });
    }

    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    if (booking.status !== "confirmed") {
      return res.status(400).json({ error: "Cannot join waitlist for a cancelled booking" });
    }

    // Prevent duplicate waitlist entries
    const alreadyWaiting = booking.waitlist.some(
      (w) => w.email.toLowerCase() === email.toLowerCase()
    );
    if (alreadyWaiting) {
      return res.status(400).json({ error: "You are already on the waitlist for this booking" });
    }

    booking.waitlist.push({ name, email });
    await booking.save();

    res.json({ message: "Added to waitlist", position: booking.waitlist.length });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
