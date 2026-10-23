import type { Metadata } from "next";
import { GenjutsuFlow } from "../../components/flows/genjutsu/GenjutsuFlow";

export const metadata: Metadata = {
  title: "Genjutsu · Kinemi",
  description:
    "Move a performance from a source clip onto a face or character, or swap one object into a shot.",
};

export default function GenjutsuPage() {
  return <GenjutsuFlow />;
}
