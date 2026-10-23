import type { Metadata } from "next";
import { cameraMoves } from "../../lib/presets/load";
import { PresetGallery } from "../../components/flows/presets/PresetGallery";

export const metadata: Metadata = {
  title: "Presets · Kinemi",
};

export default function PresetsPage() {
  return <PresetGallery moves={cameraMoves} />;
}
