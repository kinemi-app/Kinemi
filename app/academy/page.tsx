import type { Metadata } from "next";
import { AcademyFlow } from "../../components/flows/academy/AcademyFlow";

export const metadata: Metadata = {
  title: "Academy · Kinemi",
  description:
    "Eight short lessons on building a shot in Kinemi: camera moves, looks, Soul palettes, AI Cast, re-shoots, motion transfer, editing and costs.",
};

export default function AcademyPage() {
  return <AcademyFlow />;
}
