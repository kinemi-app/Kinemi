import type { Metadata } from "next";
import { CanvasFlow } from "../../components/flows/canvas/CanvasFlow";

export const metadata: Metadata = {
  title: "Canvas · Kinemi",
  description:
    "Wire models into a node board, run the steps in order, save the graph as a template and share the board.",
};

export default function CanvasPage() {
  return <CanvasFlow />;
}
