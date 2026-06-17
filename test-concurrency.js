#!/usr/bin/env node
/**
 * RoomIt — Double-Booking Concurrency Test
 *
 * Fires two (or more) simultaneous booking requests for the same room+slot
 * and verifies exactly one succeeds (HTTP 201) and the rest fail (HTTP 409).
 *
 * Usage:
 *   node test-concurrency.js [API_URL] [ROOM_ID] [DATE]
 *
 * Examples:
 *   node test-concurrency.js
 *   node test-concurrency.js http://localhost:5000 <roomId> 2025-08-01
 */

const API_URL = process.argv[2] || "http://localhost:5000";
const ROOM_ID = process.argv[3]; // Will be fetched from /api/rooms if not provided
const DATE    = process.argv[4] || new Date(Date.now() + 86400000).toISOString().split("T")[0]; // tomorrow

const CONCURRENT_REQUESTS = 5; // How many simultaneous requests to fire

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function getRoomId() {
  if (ROOM_ID) return ROOM_ID;
  const { status, data } = await fetchJson(`${API_URL}/api/rooms`);
  if (status !== 200 || !data.length) {
    throw new Error("Could not fetch rooms. Is the backend running and seeded?");
  }
  console.log(`Using room: ${data[0].name} (${data[0]._id})`);
  return data[0]._id;
}

async function findFreeSlot(roomId) {
  const { status, data } = await fetchJson(
    `${API_URL}/api/rooms/${roomId}/availability?date=${DATE}`
  );
  if (status !== 200) throw new Error("Could not fetch availability");
  const freeSlot = data.slots.find((s) => s.status === "available" && s.time >= "10:00");
  if (!freeSlot) throw new Error(`No free slots on ${DATE} — try a different date`);
  const [h, m] = freeSlot.time.split(":").map(Number);
  const endMin = h * 60 + m + 30;
  return {
    startTime: freeSlot.time,
    endTime: `${String(Math.floor(endMin / 60)).padStart(2,"0")}:${String(endMin%60).padStart(2,"0")}`,
  };
}

async function runTest() {
  console.log("\n🔥 RoomIt Concurrency Test");
  console.log("=".repeat(50));
  console.log(`API:  ${API_URL}`);
  console.log(`Date: ${DATE}`);
  console.log(`Simultaneous requests: ${CONCURRENT_REQUESTS}`);
  console.log("=".repeat(50));

  const roomId = await getRoomId();
  const { startTime, endTime } = await findFreeSlot(roomId);
  console.log(`\nTarget slot: ${startTime} – ${endTime} on ${DATE}`);
  console.log(`Room ID:     ${roomId}`);
  console.log("\nFiring all requests simultaneously...\n");

  const requests = Array.from({ length: CONCURRENT_REQUESTS }, (_, i) => ({
    roomId,
    date: DATE,
    startTime,
    endTime,
    name: `Test User ${i + 1}`,
    email: `testuser${i + 1}@example.com`,
    title: `Concurrency Test Request #${i + 1}`,
  }));

  // Fire all requests at the same time (Promise.all = truly concurrent)
  const start = Date.now();
  const results = await Promise.all(
    requests.map((body) =>
      fetchJson(`${API_URL}/api/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    )
  );
  const elapsed = Date.now() - start;

  // Analyze results
  const successes = results.filter((r) => r.status === 201);
  const conflicts = results.filter((r) => r.status === 409);
  const errors    = results.filter((r) => r.status !== 201 && r.status !== 409);

  console.log("Results:");
  results.forEach((r, i) => {
    const icon = r.status === 201 ? "✅" : r.status === 409 ? "❌" : "⚠️";
    const msg  = r.status === 201
      ? `BOOKED (id: ${r.data._id})`
      : r.status === 409
      ? `CONFLICT — ${r.data.error}`
      : `ERROR ${r.status} — ${JSON.stringify(r.data)}`;
    console.log(`  ${icon} Request ${i + 1}: HTTP ${r.status} — ${msg}`);
  });

  console.log("\n" + "=".repeat(50));
  console.log(`Completed in ${elapsed}ms`);
  console.log(`  ✅ Succeeded: ${successes.length}`);
  console.log(`  ❌ Conflicts: ${conflicts.length}`);
  console.log(`  ⚠️  Errors:    ${errors.length}`);
  console.log("=".repeat(50));

  // Assertion
  if (successes.length === 1 && conflicts.length === CONCURRENT_REQUESTS - 1 && errors.length === 0) {
    console.log("\n🎉 TEST PASSED — Exactly one booking succeeded. Double-booking prevented.");
  } else if (successes.length > 1) {
    console.log(`\n🚨 TEST FAILED — ${successes.length} bookings succeeded for the same slot! Double-booking occurred.`);
    process.exit(1);
  } else if (successes.length === 0) {
    console.log("\n⚠️  WARNING — No bookings succeeded. Slot may have already been taken.");
  }

  // Verify via availability API
  console.log("\nVerifying slot status via availability API...");
  const { data: avail } = await fetchJson(
    `${API_URL}/api/rooms/${roomId}/availability?date=${DATE}`
  );
  const slot = avail.slots?.find((s) => s.time === startTime);
  if (slot?.status === "booked") {
    console.log(`✅ Slot ${startTime} is now 'booked' in the availability grid.`);
    if (slot.booking) {
      console.log(`   Booked by: ${slot.booking.bookedBy} — "${slot.booking.title}"`);
    }
  } else {
    console.log(`⚠️  Slot ${startTime} status: ${slot?.status}`);
  }
}

runTest().catch((err) => {
  console.error("\n❌ Test failed with error:", err.message);
  process.exit(1);
});
