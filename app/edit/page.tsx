import type { Metadata } from "next";
import { EditFlow } from "../../components/flows/edit/EditFlow";

export const metadata: Metadata = {
  title: "Edit · Kinemi",
  description:
    "Describe a change to a finished clip and re-render it, keeping the framing, camera and timing.",
};

export default function EditPage() {
  return <EditFlow />;
}
