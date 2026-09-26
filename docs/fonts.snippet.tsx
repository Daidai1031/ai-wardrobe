// Add to src/app/layout.tsx (the root layout). Uses next/font/google so the
// fonts are self-hosted and optimized by Next.js rather than loaded via a
// runtime <link> tag.

import { Ibarra_Real_Nova, Public_Sans } from "next/font/google";

const ibarraRealNova = Ibarra_Real_Nova({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-serif",
  display: "swap",
});

const publicSans = Public_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

// In the RootLayout component, add both variable classes to <html> (or <body>):
//
// export default function RootLayout({ children }: { children: React.ReactNode }) {
//   return (
//     <html lang="en" className={`${ibarraRealNova.variable} ${publicSans.variable}`}>
//       <body>{children}</body>
//     </html>
//   );
// }
//
// This exposes --font-serif / --font-sans as CSS custom properties, which the
// tailwind.config fontFamily block (see tailwind.config.snippet.ts) already
// references — so font-serif / font-sans utility classes work app-wide once
// both files are in place.
