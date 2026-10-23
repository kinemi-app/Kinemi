import type { Metadata } from "next";
import { UpscaleFlow } from "../../components/flows/upscale/UpscaleFlow";

export const metadata: Metadata = {
  title: "Upscale · Kinemi",
  description: "Take a clip to 4K, interpolate to 60 fps and smooth flicker.",
};

export default function UpscalePage() {
  return <UpscaleFlow />;
}
