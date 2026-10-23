import type { Metadata } from "next";
import { AdsFlow } from "../../components/flows/ads/AdsFlow";

export const metadata: Metadata = {
  title: "Marketing Studio · Kinemi",
  description:
    "Turn a product photo or URL into a still ad, a short UGC clip, hook lines or marketplace posters.",
};

export default function AdsPage() {
  return <AdsFlow />;
}
