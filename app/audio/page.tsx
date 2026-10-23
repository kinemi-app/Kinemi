import type { Metadata } from "next";
import { AudioFlow } from "../../components/flows/audio/AudioFlow";

export const metadata: Metadata = {
  title: "Audio Studio · Kinemi",
  description:
    "Voiceover, voice cloning, voice swap, dubbing, multi-speaker scenes and sound effects.",
};

export default function AudioPage() {
  return <AudioFlow />;
}
