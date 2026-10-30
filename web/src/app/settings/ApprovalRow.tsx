// The chat card's YOLO switch: whether renders the chat asks for wait for an Approve click.
import { patchSettings, settings } from '../store';
import { Toggle } from '../ui/controls';
import { Row } from './parts';

export function ApprovalRow() {
  return (
    <Row label="YOLO: run without asking" desc="Off: when Kinemi asks to render, a card waits for your Approve click. On: that render starts at once and spends credits. Setting up a shot never renders on its own.">
      <Toggle label="Run without asking" sub="Renders the chat asks for start without the Approve card" on={!!settings.value.yolo} onChange={(v) => patchSettings({ yolo: v })} />
    </Row>
  );
}
