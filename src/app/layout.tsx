import type { Metadata } from "next";
import { Archivo, Cormorant, JetBrains_Mono } from "next/font/google";
import { connection } from "next/server";
import { getAppearance, toAppearanceDto } from "@/lib/appearance/store";
import { appearanceCss } from "@/lib/appearance/themes";
import "./globals.css";

const cormorant = Cormorant({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-cormorant",
  display: "swap",
});

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-archivo",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Daily Intake",
  description: "Today's calendar, what I'm working on, and what's waiting or broken.",
};

// Every theme's tokens and painting rules; <html data-theme / data-background> picks one.
const APPEARANCE_CSS = appearanceCss();

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The saved look is read per request so the first paint is already in it (no flash of the default).
  await connection();
  const appearance = await getAppearance().catch(() => toAppearanceDto(null));
  return (
    <html
      lang="en"
      data-theme={appearance.theme}
      data-background={appearance.background}
      className={`${cormorant.variable} ${archivo.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <style dangerouslySetInnerHTML={{ __html: APPEARANCE_CSS }} />
      </head>
      <body>
        <div className="page-background" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
