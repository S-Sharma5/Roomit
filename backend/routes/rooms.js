const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Room = require("../models/Room");
const Booking = require("../models/Booking");
const { SlotLock } = require("../models/Booking");

// GET /api/rooms — list all active rooms
router.get("/", async (req, res, next) => {
  try {
    const rooms = await Room.find({ isActive: true }).sort({ floor: 1, name: 1 });
    res.json(rooms);
  } catch (err) {
    next(err);
  }
});

// GET /api/rooms/:id — single room detail
router.get("/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid room ID" });
    }
    const room = await Room.findById(req.params.id);
    if (!room || !room.isActive) {
      return res.status(404).json({ error: "Room not found" });
    }
    res.json(room);
  } catch (err) {
    next(err);
  }
});

// GET /api/rooms/:id/availability?date=YYYY-MM-DD
// Returns a 30-minute slot grid with availability status for the day
router.get("/:id/availability", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid room ID" });
    }

    const { date } = req.query;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: "date query param required (YYYY-MM-DD)" });
    }

    const room = await Room.findById(req.params.id);
    if (!room || !room.isActive) {
      return res.status(404).json({ error: "Room not found" });
    }

    // Fetch all confirmed bookings for this room on this date
    const bookings = await Booking.find({
      room: req.params.id,
      date,
      status: "confirmed",
    }).select("startTime endTime slots bookedBy title waitlist");

    // Build a map of occupied slot keys from SlotLocks
    // (This is THE source of truth — same data the booking endpoint checks)
    const occupiedKeys = new Set();
    const slotLocks = await SlotLock.find({
      key: { $regex: `^${req.params.id}\\|${date}\\|` },
    });
    slotLocks.forEach((lock) => {
      const [, , time] = lock.key.split("|");
      occupiedKeys.add(time);
    });

    // Build buffer slots if room has bufferMinutes
    const bufferSlots = new Set();
    if (room.bufferMinutes > 0) {
      bookings.forEach((b) => {
        // Add buffer slots after each booking's endTime
        let [h, m] = b.endTime.split(":").map(Number);
        let bufferRemaining = room.bufferMinutes;
        while (bufferRemaining > 0) {
          m += 30;
          if (m >= 60) { m -= 60; h += 1; }
          if (h >= 24) break;
          const slotKey = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
          bufferSlots.add(slotKey);
          bufferRemaining -= 30;
        }
      });
    }

    // Generate all 30-min slots for the day (00:00 – 23:30)
    const slots = [];
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 30) {
        const time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        const isOccupied = occupiedKeys.has(time);
        const isBuffer = !isOccupied && bufferSlots.has(time);

        // Find which booking occupies this slot (if any)
        let bookingInfo = null;
        if (isOccupied) {
          const booking = bookings.find((b) => b.slots.includes(time));
          if (booking) {
            bookingInfo = {
              bookingId: booking._id,
              title: booking.title,
              bookedBy: booking.bookedBy.name,
              startTime: booking.startTime,
              endTime: booking.endTime,
              waitlistCount: booking.waitlist?.length || 0,
            };
          }
        }

        slots.push({
          time,
          status: isOccupied ? "booked" : isBuffer ? "buffer" : "available",
          booking: bookingInfo,
        });
      }
    }

    res.json({
      room: {
        _id: room._id,
        name: room.name,
        location: room.location,
        floor: room.floor,
        capacity: room.capacity,
        bufferMinutes: room.bufferMinutes,
        amenities: room.amenities,
      },
      date,
      slots,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
