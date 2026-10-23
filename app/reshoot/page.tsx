import type { Metadata } from "next";
import { ReshootFlow } from "../../components/flows/reshoot/ReshootFlow";

export const metadata: Metadata = {
  title: "Re-shoot · Kinemi",
};

export default function ReshootPage() {
  return <ReshootFlow />;
}
