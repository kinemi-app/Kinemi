import type { Metadata } from "next";
import { PrevizFlow } from "../../components/flows/previz/PrevizFlow";

export const metadata: Metadata = {
  title: "3D Previz · Kinemi",
  description:
    "Greybox a scene in the browser, orbit the camera, export a GLB, a clip or a still, and send camera keyframes to After Effects.",
};

export default function PrevizPage() {
  return <PrevizFlow />;
}
