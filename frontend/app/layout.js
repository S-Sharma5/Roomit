import "./globals.css";
import { AuthProvider } from "@/lib/AuthContext";
import NavBar from "@/components/NavBar";

export const metadata = {
  title: "RoomIt — Meeting Room Booking",
  description: "Book meeting rooms simply and reliably.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#f4f6fb]">
        <AuthProvider>
          <NavBar />
          <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
            {children}
          </main>
        </AuthProvider>
      </body>
    </html>
  );
}
