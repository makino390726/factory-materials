import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import AuthGuard from "./auth-guard";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "Factory Materials - 在庫管理システム",
  description: "QRコードを使用した高機能な在庫管理システム。製品ラベル印刷、QRスキャン、ダッシュボード機能を完備。",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Factory Materials",
  },
  formatDetection: {
    telephone: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="dark" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <Script id="fm-theme" strategy="beforeInteractive">
          {`(function(){try{var t=localStorage.getItem("fm-theme");var r=document.documentElement;if(t==="light"){r.classList.remove("dark");r.classList.add("light")}else{r.classList.add("dark");r.classList.remove("light")}}catch(e){}})()`}
        </Script>
        <AuthGuard>{children}</AuthGuard>
      </body>
    </html>
  );
}
