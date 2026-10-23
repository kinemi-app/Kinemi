import type { Metadata } from "next";
import { StudioFlow } from "../../components/flows/studio/StudioFlow";

export const metadata: Metadata = {
  title: "Supercomputer · Kinemi",
  description:
    "Plan a campaign from one brief, run its shots in batches, and drive the same jobs from the CLI.",
};

export default function StudioPage() {
  return <StudioFlow />;
}
