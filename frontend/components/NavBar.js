"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Calendar, BookOpen, Building2, LogOut, LogIn, UserPlus } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";

export default function NavBar() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();

  function handleLogout() {
    logout();
    router.push("/login");
  }

  return (
    <nav className="bg-white border-b border-gray-100 sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold text-gray-900 text-base">
          <div className="w-7 h-7 bg-brand-600 rounded-lg flex items-center justify-center">
            <Building2 className="w-4 h-4 text-white" />
          </div>
          RoomIt
        </Link>

        <div className="flex items-center gap-1">
          <Link
            href="/"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-colors"
          >
            <Calendar className="w-4 h-4" />
            Rooms
          </Link>
          <Link
            href="/bookings"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-colors"
          >
            <BookOpen className="w-4 h-4" />
            My Bookings
          </Link>

          <div className="w-px h-5 bg-gray-200 mx-2" />

          {loading ? (
            <div className="w-20 h-7" />
          ) : user ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 hidden sm:inline">{user.name}</span>
              <button
                onClick={handleLogout}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Log out
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <Link
                href="/login"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-colors"
              >
                <LogIn className="w-4 h-4" />
                Log in
              </Link>
              <Link
                href="/signup"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-brand-600 text-white hover:bg-brand-700 transition-colors"
              >
                <UserPlus className="w-4 h-4" />
                Sign up
              </Link>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
