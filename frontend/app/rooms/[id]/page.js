"use client";
import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft, ChevronRight, Users, MapPin, Calendar,
  Loader2, CheckCircle, AlertCircle, Clock, RefreshCw
} from "lucide-react";
import { useAuth } from "@/lib/AuthContext";

const TODAY = new Date().toISOString().split("T")[0];

function formatDate(dateStr) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-IN", {
    weekday: "long", month: "long", day: "numeric",
  });
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

// Only show slots 07:00–21:30 (business hours)
const BUSINESS_START = "07:00";
const BUSINESS_END = "21:30";

function inBusinessHours(time) {
  return time >= BUSINESS_START && time <= BUSINESS_END;
}

export default function RoomPage() {
  const { id } = useParams();
  const router = useRouter();
  const { user } = useAuth();

  const [date, setDate] = useState(TODAY);
  const [availability, setAvailability] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Booking form state
  const [selectedSlots, setSelectedSlots] = useState([]);
  const [form, setForm] = useState({ name: "", email: "", title: "" });
  const [booking, setBooking] = useState({ loading: false, success: null, error: null });

  // Auto-fill name/email once the logged-in user loads (don't clobber if they've
  // already started typing something different, e.g. booking on someone else's behalf)
  useEffect(() => {
    if (user) {
      setForm((f) => ({
        ...f,
        name: f.name || user.name,
        email: f.email || user.email,
      }));
    }
  }, [user]);

  // Recurring form state
  const [showRecurring, setShowRecurring] = useState(false);
  const [recurringWeeks, setRecurringWeeks] = useState(6);
  const [recurringConflict, setRecurringConflict] = useState("skip");

  const fetchAvailability = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelectedSlots([]);
    try {
      const res = await fetch(`/api/rooms/${id}/availability?date=${date}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load availability");
      setAvailability(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id, date]);

  useEffect(() => { fetchAvailability(); }, [fetchAvailability]);

  // Build consecutive slot selection
  const businessSlots = availability?.slots?.filter((s) => inBusinessHours(s.time)) || [];

  function handleSlotClick(slot) {
    if (slot.status !== "available") return;
    setBooking({ loading: false, success: null, error: null });

    setSelectedSlots((prev) => {
      if (prev.length === 0) return [slot.time];

      const allTimes = businessSlots.map((s) => s.time);
      const firstIdx = allTimes.indexOf(prev[0]);
      const lastIdx = allTimes.indexOf(prev[prev.length - 1]);
      const clickedIdx = allTimes.indexOf(slot.time);

      // Allow extending selection, or deselect if clicking first/last
      if (slot.time === prev[0] && prev.length === 1) return [];
      if (clickedIdx === firstIdx - 1 || clickedIdx > lastIdx) {
        // Check all slots between are available
        const start = Math.min(firstIdx, clickedIdx);
        const end = Math.max(lastIdx, clickedIdx);
        const range = allTimes.slice(start, end + 1);
        const allAvail = range.every((t) => {
          const s = businessSlots.find((x) => x.time === t);
          return s && s.status === "available";
        });
        if (!allAvail) return [slot.time]; // Reset to just this slot
        return range;
      }
      return [slot.time];
    });
  }

  function getStartEndFromSelected() {
    if (!selectedSlots.length) return { startTime: null, endTime: null };
    const sorted = [...selectedSlots].sort();
    const start = sorted[0];
    // endTime = last slot + 30 min
    const [h, m] = sorted[sorted.length - 1].split(":").map(Number);
    const endMin = h * 60 + m + 30;
    const endTime = `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
    return { startTime: start, endTime };
  }

  async function handleBook(e) {
    e.preventDefault();
    if (!selectedSlots.length) return;

    const { startTime, endTime } = getStartEndFromSelected();
    setBooking({ loading: true, success: null, error: null });

    try {
      const body = {
        roomId: id,
        date,
        startTime,
        endTime,
        name: form.name,
        email: form.email,
        title: form.title,
      };

      if (showRecurring) {
        body.recurring = { enabled: true, weeks: recurringWeeks, onConflict: recurringConflict };
      }

      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        setBooking({
          loading: false,
          success: null,
          error: data.error || "Booking failed",
          conflictSlots: data.conflictingSlots,
        });
        return;
      }

      setBooking({ loading: false, success: data, error: null });
      setSelectedSlots([]);
      setForm({ name: "", email: "", title: "" });
      // Refresh availability without full page reload
      fetchAvailability();
    } catch (e) {
      setBooking({ loading: false, success: null, error: "Network error. Please try again." });
    }
  }

  const { startTime, endTime } = getStartEndFromSelected();
  const durationMins = selectedSlots.length * 30;

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <Link href="/" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-900 mb-4">
          <ChevronLeft className="w-4 h-4 mr-1" /> All rooms
        </Link>
        {availability?.room && (
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">{availability.room.name}</h1>
              <div className="flex items-center gap-4 text-sm text-gray-500 mt-1">
                <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> Floor {availability.room.floor} · {availability.room.location}</span>
                <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {availability.room.capacity} people</span>
                {availability.room.bufferMinutes > 0 && (
                  <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {availability.room.bufferMinutes}min buffer after each booking</span>
                )}
              </div>
            </div>
            <button
              onClick={fetchAvailability}
              className="btn-secondary flex items-center gap-1.5"
              title="Refresh availability"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Date picker */}
      <div className="card p-4 mb-4 flex items-center gap-3">
        <button
          onClick={() => setDate(addDays(date, -1))}
          disabled={date <= TODAY}
          className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 text-center">
          <input
            type="date"
            value={date}
            min={TODAY}
            onChange={(e) => setDate(e.target.value)}
            className="input text-center w-48"
          />
          <p className="text-xs text-gray-400 mt-1">{formatDate(date)}</p>
        </div>
        <button
          onClick={() => setDate(addDays(date, 1))}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Slot grid */}
        <div className="lg:col-span-2">
          <div className="card p-4">
            {/* Legend */}
            <div className="flex items-center gap-4 mb-4 text-xs text-gray-500">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-white border border-gray-200 inline-block" /> Available
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-brand-500 inline-block" /> Selected
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-gray-200 inline-block" /> Booked
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-amber-100 border border-amber-200 inline-block" /> Buffer
              </span>
            </div>

            {loading ? (
              <div className="flex items-center justify-center h-48 text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading slots…
              </div>
            ) : error ? (
              <div className="text-red-600 text-sm p-4">{error}</div>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                {businessSlots.map((slot) => {
                  const isSelected = selectedSlots.includes(slot.time);
                  const isBooked = slot.status === "booked";
                  const isBuffer = slot.status === "buffer";
                  const isAvail = slot.status === "available";

                  return (
                    <button
                      key={slot.time}
                      disabled={!isAvail}
                      onClick={() => handleSlotClick(slot)}
                      title={
                        isBooked
                          ? `${slot.booking?.title || "Booked"} by ${slot.booking?.bookedBy || ""}`
                          : isBuffer
                          ? "Buffer time (room cleaning)"
                          : slot.time
                      }
                      className={`
                        relative py-2 px-1 rounded-lg text-xs font-mono font-medium transition-all
                        ${isSelected ? "bg-brand-600 text-white ring-2 ring-brand-400 ring-offset-1" : ""}
                        ${isAvail && !isSelected ? "bg-white border border-gray-200 hover:border-brand-400 hover:bg-brand-50 text-gray-700 cursor-pointer" : ""}
                        ${isBooked ? "bg-gray-100 text-gray-400 cursor-not-allowed" : ""}
                        ${isBuffer ? "bg-amber-50 border border-amber-100 text-amber-400 cursor-not-allowed" : ""}
                      `}
                    >
                      {slot.time}
                      {isBooked && (
                        <span className="absolute inset-0 flex items-end justify-center pb-0.5">
                          <span className="text-[9px] text-gray-400 truncate px-0.5">
                            {slot.booking?.bookedBy?.split(" ")[0]}
                          </span>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Booking form */}
        <div className="lg:col-span-1">
          <div className="card p-5 sticky top-20">
            <h2 className="font-semibold text-gray-900 mb-4">Book a slot</h2>

            {selectedSlots.length > 0 ? (
              <div className="mb-4 p-3 bg-brand-50 rounded-lg border border-brand-100 text-sm">
                <div className="font-medium text-brand-700">
                  {startTime} – {endTime}
                </div>
                <div className="text-brand-600 text-xs mt-0.5">
                  {durationMins} minutes · {selectedSlots.length} slot{selectedSlots.length > 1 ? "s" : ""}
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400 mb-4">
                Click available slots on the grid to select your time.
              </p>
            )}

            <form onSubmit={handleBook} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Your name</label>
                <input
                  className="input"
                  placeholder="Jane Smith"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                <input
                  type="email"
                  className="input"
                  placeholder="jane@company.com"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Meeting title</label>
                <input
                  className="input"
                  placeholder="Sprint planning"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  required
                />
              </div>

              {/* Recurring toggle */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setShowRecurring((v) => !v)}
                  className="text-xs text-brand-600 hover:underline"
                >
                  {showRecurring ? "▼" : "▶"} Make this recurring (weekly)
                </button>
                {showRecurring && (
                  <div className="mt-2 p-3 bg-gray-50 rounded-lg space-y-2">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Number of weeks</label>
                      <input
                        type="number"
                        min={1} max={52}
                        value={recurringWeeks}
                        onChange={(e) => setRecurringWeeks(Number(e.target.value))}
                        className="input w-24"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">On conflict</label>
                      <select
                        value={recurringConflict}
                        onChange={(e) => setRecurringConflict(e.target.value)}
                        className="input"
                      >
                        <option value="skip">Skip conflicting dates, book the rest</option>
                        <option value="abort">Abort entire series on any conflict</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={!selectedSlots.length || booking.loading}
                className="btn-primary w-full flex items-center justify-center gap-2 mt-2"
              >
                {booking.loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {booking.loading ? "Booking…" : "Confirm booking"}
              </button>
            </form>

            {/* Success */}
            {booking.success && !booking.success.recurringGroupId && (
              <div className="mt-3 p-3 bg-emerald-50 rounded-lg border border-emerald-100 text-sm text-emerald-700 flex items-start gap-2">
                <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium">Booking confirmed!</div>
                  <div className="text-xs text-emerald-600 mt-0.5">
                    {booking.success.startTime} – {booking.success.endTime} on {booking.success.date}
                  </div>
                  <Link href="/bookings" className="text-xs underline mt-1 block">View my bookings →</Link>
                </div>
              </div>
            )}
            {booking.success && booking.success.recurringGroupId && (
              <div className="mt-3 p-3 bg-emerald-50 rounded-lg border border-emerald-100 text-sm text-emerald-700 flex items-start gap-2">
                <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium">{booking.success.message}</div>
                  {booking.success.skipped?.length > 0 && (
                    <div className="text-xs mt-1">
                      Skipped {booking.success.skipped.length} conflicting date(s).
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Error */}
            {booking.error && (
              <div className="mt-3 p-3 bg-red-50 rounded-lg border border-red-100 text-sm text-red-700 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium">{booking.error}</div>
                  {booking.conflictSlots?.length > 0 && (
                    <div className="text-xs mt-1">
                      Conflicting slots: {booking.conflictSlots.join(", ")}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
