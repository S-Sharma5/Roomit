#!/usr/bin/env node
/**
 * RoomIt — Daily Quota Concurrency Test (Section 4.5)
 *
 * Verifies the per-user daily quota (4 hours / 240 minutes) holds under
 * concurrent requests. Books a user up to 3 hours, then fires two
 * simultaneous 1-hour requests — at most one should succeed (since
 * 3 + 1 + 1 = 5 hours > 4 hour cap).
 *
 * Usage:
 *   node test-quota-concurrency.js [API_URL] [ROOM_ID] [DATE]
 */

const API_URL = process.argv[2] || "http://localhost:5000";
let ROOM_ID = process.argv[3];
const DATE = process.argv[4] || new Date(Date.now() + 2 * 86400000).toISOString().split("T")[0];

const TEST_EMAIL = `quota-test-${Date.now()}@example.com`;

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function getRoomId() {
  if (ROOM_ID) return ROOM_ID;
  const { data } = await fetchJson(`${API_URL}/api/rooms`);
  if (!data?.length) throw new Error("No rooms found — seed the database first.");
  console.log(`Using room: ${data[0].name} (${data[0]._id})`);
  return data[0]._id;
}

async function book(roomId, startTime, endTime, title) {
  return fetchJson(`${API_URL}/api/bookings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      roomId, date: DATE, startTime, endTime,
      name: "Quota Test User", email: TEST_EMAIL, title,
    }),
  });
}

async function run() {
  console.log("\n🔥 RoomIt Daily Quota Concurrency Test");
  console.log("=".repeat(50));
  console.log(`Email: ${TEST_EMAIL}`);
  console.log(`Date:  ${DATE}`);
  console.log("=".repeat(50));

  const roomId = await getRoomId();

  // Step 1: Use up 3 hours of quota with a single booking (sequential, no race)
  console.log("\nStep 1 — Booking 3 hours (06:00–09:00) to set up the test...");
  const setup = await book(roomId, "06:00", "09:00", "Quota setup booking");
  if (setup.status !== 201) {
    console.log("⚠️  Setup booking failed:", setup.data);
    console.log("    (If 06:00–09:00 is already booked on this room/date, pick a different DATE.)");
    process.exit(1);
  }
  console.log(`✅ Setup booking succeeded. 3h/4h quota now used for ${TEST_EMAIL}.`);

  // Step 2: Fire two simultaneous 1-hour requests (3h + 1h + 1h = 5h > 4h cap)
  console.log("\nStep 2 — Firing two simultaneous 1-hour requests (different rooms ok, same user/day)...");
  const start = Date.now();
  const [a, b] = await Promise.all([
    book(roomId, "10:00", "11:00", "Quota race request A"),
    book(roomId, "13:00", "14:00", "Quota race request B"),
  ]);
  const elapsed = Date.now() - start;

  console.log(`\nCompleted in ${elapsed}ms`);
  console.log(`  Request A: HTTP ${a.status} — ${a.status === 201 ? "BOOKED" : a.data.error}`);
  console.log(`  Request B: HTTP ${b.status} — ${b.status === 201 ? "BOOKED" : b.data.error}`);

  const successes = [a, b].filter((r) => r.status === 201).length;

  console.log("\n" + "=".repeat(50));
  if (successes <= 1) {
    console.log(`🎉 TEST PASSED — ${successes} of 2 requests succeeded (at most 1 expected, since 3h+1h+1h=5h > 4h cap).`);
  } else {
    console.log(`🚨 TEST FAILED — ${successes} requests succeeded. Daily quota was violated under concurrency!`);
    process.exit(1);
  }
  console.log("=".repeat(50));
}

run().catch((err) => {
  console.error("\n❌ Test error:", err.message);
  process.exit(1);
});
