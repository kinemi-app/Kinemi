import type { Metadata } from "next";
import { FashionFlow } from "../../components/flows/fashion/FashionFlow";

export const metadata: Metadata = {
  title: "Fashion Factory · Kinemi",
  description:
    "Swap a garment or model, match drape and lighting, and build an influencer campaign still.",
};

export default function FashionPage() {
  return <FashionFlow />;
}
