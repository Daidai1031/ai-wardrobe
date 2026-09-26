import type { Metadata } from "next";
import { Alex_Brush, EB_Garamond } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const alexBrush = Alex_Brush({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-heading",
  display: "swap",
});

const ebGaramond = EB_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AI Wardrobe — Your Personal Stylist",
  description: "AI-powered wardrobe management and styling for executive professionals",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${alexBrush.variable} ${ebGaramond.variable}`}>
      <body className="min-h-screen font-sans">
        {children}
        <Toaster position="bottom-right" richColors />
      </body>
    </html>
  );
}
