"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Users, MapPin, Wifi, Monitor, Phone, PenLine, ChevronRight, Loader2 } from "lucide-react";

const AMENITY_ICONS = {
  Projector: Monitor,
  Whiteboard: PenLine,
  "Video Conferencing": Wifi,
  "Conference Phone": Phone,
  "TV Screen": Monitor,
};

export default function HomePage() {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/rooms")
      .then((r) => r.json())
      .then((data) => {
        setRooms(data);
        setLoading(false);
      })
      .catch(() => {
        setError("Could not load rooms. Is the backend running?");
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Loading rooms…
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-6 text-center text-red-600">
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Meeting Rooms</h1>
        <p className="text-gray-500 text-sm mt-1">
          Select a room to check availability and book a slot.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4">
        {rooms.map((room) => (
          <Link
            key={room._id}
            href={`/rooms/${room._id}`}
            className="card p-5 hover:shadow-md hover:border-brand-200 transition-all group cursor-pointer"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="font-semibold text-gray-900 text-lg group-hover:text-brand-600 transition-colors">
                    {room.name}
                  </h2>
                  {room.bufferMinutes > 0 && (
                    <span className="text-xs bg-amber-50 text-amber-600 border border-amber-100 rounded-full px-2 py-0.5">
                      {room.bufferMinutes}min buffer
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-sm text-gray-500">
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" />
                    Floor {room.floor} · {room.location}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" />
                    {room.capacity} people
                  </span>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-brand-500 transition-colors mt-1" />
            </div>

            {room.amenities?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-gray-50">
                {room.amenities.map((a) => {
                  const Icon = AMENITY_ICONS[a] || PenLine;
                  return (
                    <span
                      key={a}
                      className="flex items-center gap-1 text-xs bg-gray-50 text-gray-500 rounded px-2 py-1"
                    >
                      <Icon className="w-3 h-3" />
                      {a}
                    </span>
                  );
                })}
              </div>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
