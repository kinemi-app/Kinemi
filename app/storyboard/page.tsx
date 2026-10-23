import type { Metadata } from "next";
import { StoryboardFlow } from "../../components/flows/storyboard/StoryboardFlow";

export const metadata: Metadata = {
  title: "Storyboard · Kinemi",
  description:
    "Line up a shot list and render it in order: every shot keeps its own prompt, model and duration.",
};

export default function StoryboardPage() {
  return <StoryboardFlow />;
}
