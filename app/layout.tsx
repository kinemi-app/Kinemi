import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TopBar } from "../components/shell/TopBar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kinemi",
  description: "An open film studio for ComfyUI: camera moves, re-shoots and motion transfer.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TopBar />
        {children}
      </body>
    </html>
  );
}
