import type { Metadata } from "next";
import { CinematicFlow } from "../../components/flows/cinematic/CinematicFlow";

export const metadata: Metadata = {
  title: "Cinematic · Kinemi",
};

export default function CinematicPage() {
  return <CinematicFlow />;
}
