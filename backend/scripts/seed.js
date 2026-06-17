require("dotenv").config();
const mongoose = require("mongoose");
const Room = require("../models/Room");
const Booking = require("../models/Booking");
const { SlotLock, QuotaLedger } = require("../models/Booking");
const User = require("../models/User");

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/roomit";

function timeToMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function generateSlots(startTime, endTime) {
  const slots = [];
  let cur = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  while (cur < end) {
    const h = Math.floor(cur / 60);
    const m = cur % 60;
    slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    cur += 30;
  }
  return slots;
}

function addDays(base, days) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

async function seed() {
  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB");

  // Clear existing data
  await SlotLock.deleteMany({});
  await QuotaLedger.deleteMany({});
  await Booking.deleteMany({});
  await Room.deleteMany({});
  await User.deleteMany({});
  console.log("Cleared existing data");

  // ── Create test User accounts (so you can log in as each of them) ─────────
  const TEST_PASSWORD = "password123";
  const testUsers = [
    { name: "Priya Sharma", email: "priya@acme.com" },
    { name: "Rahul Mehta", email: "rahul@acme.com" },
    { name: "Aisha Khan", email: "aisha@acme.com" },
    { name: "Dev Patel", email: "dev@acme.com" },
  ];
  const passwordHash = await User.hashPassword(TEST_PASSWORD);
  await User.insertMany(
    testUsers.map((u) => ({ name: u.name, email: u.email, passwordHash }))
  );
  console.log(`Created ${testUsers.length} user accounts (password: "${TEST_PASSWORD}" for all)`);

  // ── Create Rooms ───────────────────────────────────────────────────────────
  const rooms = await Room.insertMany([
    {
      name: "Atlas",
      location: "North Wing",
      floor: 2,
      capacity: 10,
      bufferMinutes: 10,
      amenities: ["Projector", "Whiteboard", "Video Conferencing"],
    },
    {
      name: "Meridian",
      location: "South Wing",
      floor: 3,
      capacity: 6,
      bufferMinutes: 0,
      amenities: ["TV Screen", "Whiteboard"],
    },
    {
      name: "Zenith",
      location: "East Wing",
      floor: 1,
      capacity: 20,
      bufferMinutes: 10,
      amenities: ["Projector", "Conference Phone", "Video Conferencing", "Whiteboard"],
    },
    {
      name: "Nova",
      location: "West Wing",
      floor: 4,
      capacity: 4,
      bufferMinutes: 0,
      amenities: ["TV Screen"],
    },
  ]);
  console.log(`Created ${rooms.length} rooms`);

  // ── Create Bookings ────────────────────────────────────────────────────────
  const today = new Date().toISOString().split("T")[0];
  const tomorrow = addDays(today, 1);
  const yesterday = addDays(today, -1);
  const dayAfter = addDays(today, 2);

  // Current time for computing "within 2 hours" bookings
  const now = new Date();
  const soonHour = now.getHours();
  const soonMin = now.getMinutes() < 30 ? 30 : 0;
  const soonHourAdj = soonMin === 0 ? soonHour + 1 : soonHour;
  // booking that starts in ~1 hour (non-refundable if cancelled now)
  const withinTwoHours = `${String(soonHourAdj).padStart(2, "0")}:${String(soonMin).padStart(2, "0")}`;
  const withinTwoHoursEnd = `${String(soonHourAdj + 1).padStart(2, "0")}:${String(soonMin).padStart(2, "0")}`;

  // booking that starts in ~4 hours (refundable if cancelled now)
  const fourHoursLater = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  const refundableStart = `${String(fourHoursLater.getHours()).padStart(2, "0")}:${fourHoursLater.getMinutes() < 30 ? "00" : "30"}`;
  const refundableEnd = `${String(fourHoursLater.getHours() + 1).padStart(2, "0")}:${fourHoursLater.getMinutes() < 30 ? "00" : "30"}`;

  const bookingDefs = [
    // Today's bookings for Atlas
    { room: rooms[0], date: today, start: "09:00", end: "10:00", name: "Priya Sharma", email: "priya@acme.com", title: "Sprint Planning" },
    { room: rooms[0], date: today, start: "11:00", end: "12:30", name: "Rahul Mehta", email: "rahul@acme.com", title: "Client Demo Prep" },
    // Within 2 hours (non-refundable window) — for testing
    { room: rooms[1], date: today, start: withinTwoHours, end: withinTwoHoursEnd, name: "Aisha Khan", email: "aisha@acme.com", title: "Design Review (non-refundable test)" },
    // 4 hours from now (refundable window) — for testing
    { room: rooms[2], date: today, start: refundableStart, end: refundableEnd, name: "Dev Patel", email: "dev@acme.com", title: "Architecture Review (refundable test)" },
    // Tomorrow's bookings
    { room: rooms[0], date: tomorrow, start: "10:00", end: "11:00", name: "Priya Sharma", email: "priya@acme.com", title: "Team Sync" },
    { room: rooms[1], date: tomorrow, start: "14:00", end: "16:00", name: "Rahul Mehta", email: "rahul@acme.com", title: "Product Roadmap" },
    { room: rooms[2], date: tomorrow, start: "09:00", end: "10:30", name: "Aisha Khan", email: "aisha@acme.com", title: "All Hands Meeting" },
    { room: rooms[3], date: tomorrow, start: "15:00", end: "16:00", name: "Dev Patel", email: "dev@acme.com", title: "1:1 with Manager" },
    // Day after tomorrow
    { room: rooms[0], date: dayAfter, start: "13:00", end: "14:30", name: "Priya Sharma", email: "priya@acme.com", title: "Quarterly Review" },
    { room: rooms[1], date: dayAfter, start: "10:00", end: "11:00", name: "Rahul Mehta", email: "rahul@acme.com", title: "Budget Planning" },
    // Yesterday (past bookings)
    { room: rooms[0], date: yesterday, start: "09:00", end: "10:00", name: "Priya Sharma", email: "priya@acme.com", title: "Past Meeting", status: "confirmed" },
    { room: rooms[2], date: yesterday, start: "14:00", end: "15:00", name: "Dev Patel", email: "dev@acme.com", title: "Past Standup", status: "cancelled-refundable" },
  ];

  for (const def of bookingDefs) {
    const slots = generateSlots(def.start, def.end);
    if (!slots.length) continue;

    const booking = new Booking({
      room: def.room._id,
      date: def.date,
      startTime: def.start,
      endTime: def.end,
      slots,
      bookedBy: { name: def.name, email: def.email },
      title: def.title,
      status: def.status || "confirmed",
    });

    await booking.save();

    // Only lock slots for confirmed bookings
    if (!def.status || def.status === "confirmed") {
      const lockKeys = slots.map((s) => `${def.room._id}|${def.date}|${s}`);
      const lockDocs = lockKeys.map((key) => ({ key, bookingId: booking._id }));
      try {
        await SlotLock.insertMany(lockDocs, { ordered: false });
      } catch (e) {
        // Skip duplicate key errors on re-seed
        if (e.code !== 11000) throw e;
      }
    }
  }
  console.log(`Created ${bookingDefs.length} bookings`);

  console.log("\n🌱 Seed complete!");
  console.log(`\nLog in as any of these (password: "${TEST_PASSWORD}"):`);
  console.log(`  priya@acme.com\n  rahul@acme.com\n  aisha@acme.com\n  dev@acme.com`);
  console.log(`\nRefund test:\n  aisha@acme.com has a booking starting at ${withinTwoHours} today → NON-refundable`);
  console.log(`  dev@acme.com has a booking starting at ${refundableStart} today → REFUNDABLE`);

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed error:", err);
  process.exit(1);
});
