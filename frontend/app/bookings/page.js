"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Search, Loader2, Calendar, Clock, MapPin, CheckCircle,
  XCircle, AlertCircle, Ban, RefreshCw, Users
} from "lucide-react";
import { useAuth } from "@/lib/AuthContext";

function formatDate(dateStr) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-IN", {
    weekday: "short", month: "short", day: "numeric",
  });
}

function StatusBadge({ status }) {
  if (status === "confirmed") return <span className="badge-confirmed">Confirmed</span>;
  if (status === "cancelled-refundable") return <span className="badge-refundable">Cancelled · Refund due</span>;
  if (status === "cancelled-non-refundable") return <span className="badge-non-refundable">Cancelled · No refund</span>;
  return null;
}

function isPast(date, endTime) {
  const end = new Date(`${date}T${endTime}:00`);
  return end < new Date();
}

export default function BookingsPage() {
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [bookings, setBookings] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Cancel state
  const [cancellingId, setCancellingId] = useState(null);
  const [cancelConfirm, setCancelConfirm] = useState(null); // { id, recurringGroupId }
  const [cancelScope, setCancelScope] = useState("this");
  const [cancelResult, setCancelResult] = useState({});

  // Reschedule state
  const [rescheduling, setRescheduling] = useState(null); // booking object
  const [rescheduleForm, setRescheduleForm] = useState({ newDate: "", newStartTime: "", newEndTime: "" });
  const [rescheduleResult, setRescheduleResult] = useState(null);

  // Waitlist state
  const [waitlistForm, setWaitlistForm] = useState({ bookingId: null, name: "", email: "" });
  const [waitlistResult, setWaitlistResult] = useState(null);

  // Auto-fill from logged-in user and run the lookup automatically
  useEffect(() => {
    if (user && !email) {
      setEmail(user.email);
      fetchBookingsFor(user.email);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function fetchBookingsFor(lookupEmail) {
    if (!lookupEmail?.trim()) return;
    setLoading(true);
    setError(null);
    setBookings(null);
    try {
      const res = await fetch(`/api/bookings?email=${encodeURIComponent(lookupEmail.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setBookings(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function fetchBookings(e) {
    e?.preventDefault();
    return fetchBookingsFor(email);
  }

  async function handleCancel(booking) {
    setCancellingId(booking._id);
    setCancelResult((prev) => ({ ...prev, [booking._id]: null }));
    try {
      const res = await fetch(`/api/bookings/${booking._id}/cancel`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recurringScope: cancelScope }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCancelResult((prev) => ({ ...prev, [booking._id]: { error: data.error } }));
      } else {
        setCancelResult((prev) => ({ ...prev, [booking._id]: { success: data } }));
        // Re-fetch bookings to reflect updates
        fetchBookings();
      }
    } catch (e) {
      setCancelResult((prev) => ({ ...prev, [booking._id]: { error: "Network error" } }));
    } finally {
      setCancellingId(null);
      setCancelConfirm(null);
    }
  }

  async function handleReschedule(e) {
    e.preventDefault();
    if (!rescheduling) return;
    const { newDate, newStartTime, newEndTime } = rescheduleForm;
    setRescheduleResult({ loading: true });
    try {
      const res = await fetch(`/api/bookings/${rescheduling._id}/reschedule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newDate, newStartTime, newEndTime, version: rescheduling.version }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRescheduleResult({ error: data.error });
      } else {
        setRescheduleResult({ success: true });
        setRescheduling(null);
        fetchBookings();
      }
    } catch {
      setRescheduleResult({ error: "Network error" });
    }
  }

  async function handleWaitlist(e) {
    e.preventDefault();
    const { bookingId, name, email: wEmail } = waitlistForm;
    try {
      const res = await fetch(`/api/bookings/${bookingId}/waitlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email: wEmail }),
      });
      const data = await res.json();
      if (!res.ok) setWaitlistResult({ error: data.error });
      else {
        setWaitlistResult({ success: data.message, position: data.position });
        setWaitlistForm({ bookingId: null, name: "", email: "" });
        fetchBookings();
      }
    } catch {
      setWaitlistResult({ error: "Network error" });
    }
  }

  const today = new Date().toISOString().split("T")[0];
  const confirmed = bookings?.filter((b) => b.status === "confirmed") || [];
  const cancelled = bookings?.filter((b) => b.status !== "confirmed") || [];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">My Bookings</h1>
        <p className="text-gray-500 text-sm mt-1">Enter your email to view and manage your bookings.</p>
      </div>

      {/* Email search form */}
      <form onSubmit={fetchBookings} className="card p-4 mb-6 flex gap-3">
        <input
          type="email"
          className="input flex-1"
          placeholder="your@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          Look up
        </button>
      </form>

      {error && (
        <div className="card p-4 text-red-600 text-sm flex items-center gap-2 mb-4">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {bookings !== null && bookings.length === 0 && (
        <div className="card p-8 text-center text-gray-400">
          No bookings found for <span className="font-mono">{email}</span>.
        </div>
      )}

      {/* Confirmed bookings */}
      {confirmed.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Upcoming & Active
          </h2>
          <div className="space-y-3">
            {confirmed.map((b) => {
              const past = isPast(b.date, b.endTime);
              const result = cancelResult[b._id];
              return (
                <div key={b._id} className="card p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-gray-900 text-base">{b.title}</h3>
                        <StatusBadge status={b.status} />
                        {past && (
                          <span className="text-xs bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">Past</span>
                        )}
                        {b.recurringGroupId && (
                          <span className="text-xs bg-purple-50 text-purple-600 border border-purple-100 rounded-full px-2 py-0.5">
                            Recurring
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-3 mt-1.5 text-sm text-gray-500">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5" /> {formatDate(b.date)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" /> {b.startTime} – {b.endTime}
                        </span>
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5" /> {b.room?.name} · Floor {b.room?.floor}
                        </span>
                      </div>
                      {b.waitlist?.length > 0 && (
                        <div className="mt-1.5 text-xs text-amber-600 flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          {b.waitlist.length} person{b.waitlist.length > 1 ? "s" : ""} on waitlist
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    {!past && (
                      <div className="flex gap-2 shrink-0">
                        <button
                          onClick={() => {
                            setRescheduling(b);
                            setRescheduleForm({ newDate: b.date, newStartTime: b.startTime, newEndTime: b.endTime });
                            setRescheduleResult(null);
                          }}
                          className="btn-secondary text-xs flex items-center gap-1"
                        >
                          <RefreshCw className="w-3 h-3" /> Reschedule
                        </button>
                        <button
                          onClick={() => {
                            setCancelConfirm({ id: b._id, recurringGroupId: b.recurringGroupId });
                            setCancelScope("this");
                          }}
                          className="btn-danger text-xs flex items-center gap-1"
                        >
                          <Ban className="w-3 h-3" /> Cancel
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Cancel confirmation dialog */}
                  {cancelConfirm?.id === b._id && (
                    <div className="mt-4 p-4 bg-red-50 rounded-lg border border-red-100">
                      <p className="text-sm font-medium text-red-800 mb-2">Cancel this booking?</p>
                      {b.recurringGroupId && (
                        <div className="mb-3">
                          <label className="block text-xs text-red-700 mb-1">Cancel scope</label>
                          <select
                            value={cancelScope}
                            onChange={(e) => setCancelScope(e.target.value)}
                            className="input text-xs"
                          >
                            <option value="this">This occurrence only</option>
                            <option value="this-and-future">This and all future occurrences</option>
                          </select>
                        </div>
                      )}
                      <p className="text-xs text-red-600 mb-3">
                        Refund eligibility is determined by the server at the time of cancellation
                        (≥2 hours before start = refundable).
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleCancel(b)}
                          disabled={cancellingId === b._id}
                          className="btn-danger text-xs flex items-center gap-1"
                        >
                          {cancellingId === b._id && <Loader2 className="w-3 h-3 animate-spin" />}
                          Confirm cancel
                        </button>
                        <button onClick={() => setCancelConfirm(null)} className="btn-secondary text-xs">
                          Keep booking
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Cancel result */}
                  {result?.error && (
                    <div className="mt-3 p-3 bg-red-50 rounded-lg text-sm text-red-700 flex items-center gap-2">
                      <XCircle className="w-4 h-4" /> {result.error}
                    </div>
                  )}
                  {result?.success && (
                    <div className="mt-3 p-3 bg-emerald-50 rounded-lg text-sm text-emerald-700 flex items-start gap-2">
                      <CheckCircle className="w-4 h-4 mt-0.5" />
                      <div>
                        <div>{result.success.message}</div>
                        {result.success.cancelled && (
                          <div className="text-xs mt-0.5">{result.success.cancelled} occurrence(s) cancelled.</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Cancelled bookings */}
      {cancelled.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Cancelled
          </h2>
          <div className="space-y-3">
            {cancelled.map((b) => (
              <div key={b._id} className="card p-5 opacity-70">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-gray-700">{b.title}</h3>
                      <StatusBadge status={b.status} />
                    </div>
                    <div className="flex flex-wrap items-center gap-3 mt-1.5 text-sm text-gray-400">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" /> {formatDate(b.date)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" /> {b.startTime} – {b.endTime}
                      </span>
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5" /> {b.room?.name}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reschedule modal */}
      {rescheduling && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="card p-6 w-full max-w-md">
            <h2 className="font-semibold text-gray-900 mb-1">Reschedule booking</h2>
            <p className="text-sm text-gray-500 mb-4">
              Moving: <span className="font-medium">{rescheduling.title}</span>
            </p>
            <form onSubmit={handleReschedule} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">New date</label>
                <input type="date" className="input" min={today} value={rescheduleForm.newDate}
                  onChange={(e) => setRescheduleForm((f) => ({ ...f, newDate: e.target.value }))} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Start time</label>
                  <input type="time" step="1800" className="input" value={rescheduleForm.newStartTime}
                    onChange={(e) => setRescheduleForm((f) => ({ ...f, newStartTime: e.target.value }))} required />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">End time</label>
                  <input type="time" step="1800" className="input" value={rescheduleForm.newEndTime}
                    onChange={(e) => setRescheduleForm((f) => ({ ...f, newEndTime: e.target.value }))} required />
                </div>
              </div>
              {rescheduleResult?.error && (
                <div className="p-3 bg-red-50 rounded-lg text-sm text-red-700">
                  {rescheduleResult.error}
                </div>
              )}
              {rescheduleResult?.success && (
                <div className="p-3 bg-emerald-50 rounded-lg text-sm text-emerald-700">
                  Rescheduled successfully!
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <button type="submit" disabled={rescheduleResult?.loading}
                  className="btn-primary flex items-center gap-1.5">
                  {rescheduleResult?.loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  Confirm reschedule
                </button>
                <button type="button" onClick={() => setRescheduling(null)} className="btn-secondary">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Waitlist modal */}
      {waitlistForm.bookingId && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="card p-6 w-full max-w-sm">
            <h2 className="font-semibold text-gray-900 mb-4">Join waitlist</h2>
            <form onSubmit={handleWaitlist} className="space-y-3">
              <input className="input" placeholder="Your name" value={waitlistForm.name}
                onChange={(e) => setWaitlistForm((f) => ({ ...f, name: e.target.value }))} required />
              <input type="email" className="input" placeholder="your@email.com" value={waitlistForm.email}
                onChange={(e) => setWaitlistForm((f) => ({ ...f, email: e.target.value }))} required />
              {waitlistResult?.error && (
                <div className="p-2 bg-red-50 rounded text-sm text-red-700">{waitlistResult.error}</div>
              )}
              {waitlistResult?.success && (
                <div className="p-2 bg-emerald-50 rounded text-sm text-emerald-700">
                  {waitlistResult.success} (Position: {waitlistResult.position})
                </div>
              )}
              <div className="flex gap-2">
                <button type="submit" className="btn-primary">Join waitlist</button>
                <button type="button" onClick={() => { setWaitlistForm({ bookingId: null, name: "", email: "" }); setWaitlistResult(null); }}
                  className="btn-secondary">Close</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
