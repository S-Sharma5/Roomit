const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema(
  {
    room: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Room",
      required: true,
      index: true,
    },
    date: {
      type: String, // "YYYY-MM-DD"
      required: true,
      index: true,
    },
    startTime: {
      type: String, // "HH:MM" 24-hour
      required: true,
    },
    endTime: {
      type: String, // "HH:MM" 24-hour
      required: true,
    },
    // Store individual slot keys for atomic conflict detection via unique index
    // Each slot is "YYYY-MM-DD|HH:MM" e.g. "2025-06-01|09:00"
    slots: [
      {
        type: String,
        required: true,
      },
    ],
    bookedBy: {
      name: { type: String, required: true, trim: true },
      email: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        index: true,
      },
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["confirmed", "cancelled-refundable", "cancelled-non-refundable"],
      default: "confirmed",
    },
    // For Section 4.4 optimistic locking
    version: {
      type: Number,
      default: 0,
    },
    // For Section 4.1 recurring bookings
    recurringGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    recurringIndex: {
      type: Number,
      default: null,
    },
    // For Section 4.2 waitlist auto-promotion
    waitlist: [
      {
        name: { type: String, required: true },
        email: { type: String, required: true, lowercase: true },
        joinedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

// ─── CRITICAL: Unique index per room+date+slot ────────────────────────────────
// This is the database-level guarantee against double-booking.
// Each "slot" string encodes room+date+time. A duplicate insert will throw
// a MongoDB E11000 duplicate key error, which we catch and return as 409.
// This works even when two requests arrive simultaneously — only one INSERT wins.
const SlotLock = mongoose.model(
  "SlotLock",
  new mongoose.Schema({
    // Composite key: "roomId|YYYY-MM-DD|HH:MM"
    key: { type: String, required: true, unique: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking" },
    createdAt: { type: Date, default: Date.now },
  })
);

// ─── Per-user daily quota ledger (Section 4.5) ────────────────────────────────
// One document per (email, date). `minutesUsed` is incremented ATOMICALLY via
// findOneAndUpdate with a conditional filter (minutesUsed + requested <= 240),
// so the "check current total" and "reserve the minutes" happen as a single
// indivisible DB operation — no read-then-write gap. This is what makes the
// quota race-safe: two simultaneous requests cannot both pass the check,
// because the filter re-evaluates against whatever value is in the document
// AT THE MOMENT of the update, and MongoDB serializes writes to a single doc.
const QuotaLedger = mongoose.model(
  "QuotaLedger",
  new mongoose.Schema({
    // Composite key: "email|YYYY-MM-DD"
    key: { type: String, required: true, unique: true },
    email: { type: String, required: true },
    date: { type: String, required: true },
    minutesUsed: { type: Number, default: 0 },
  })
);

module.exports = mongoose.model("Booking", bookingSchema);
module.exports.SlotLock = SlotLock;
module.exports.QuotaLedger = QuotaLedger;
