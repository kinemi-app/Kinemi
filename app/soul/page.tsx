import type { Metadata } from "next";
import { SoulFlow } from "../../components/flows/soul/SoulFlow";

export const metadata: Metadata = {
  title: "Soul · Kinemi",
  description: "One sentence becomes a five-colour HEX palette, a Soul 2.0 preset and a demo still.",
};

export default function SoulPage() {
  return <SoulFlow />;
}
