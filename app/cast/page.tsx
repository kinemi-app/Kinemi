import type { Metadata } from "next";
import { CastFlow } from "../../components/flows/cast/CastFlow";

export const metadata: Metadata = {
  title: "AI Cast · Kinemi",
  description:
    "Save cast members with reference images and emotions, then copy their prompt tags into any shot.",
};

export default function CastPage() {
  return <CastFlow />;
}
