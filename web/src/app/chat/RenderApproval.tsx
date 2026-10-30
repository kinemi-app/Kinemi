// The bar on a call card that asks before a render spends credits: Approve starts it, Not now keeps
// the shot set up without running anything.
import { PxIcon } from '../ui/icons';
import { declineRender, renderMessage } from './actions';

export function RenderApproval({ chatId, messageId }: { chatId: string; messageId: string }) {
  return (
    <div class="call-approve" role="group" aria-label="Approve this render">
      <p class="call-approve-text">
        <PxIcon name="info" size={12} />
        Kinemi set this up. Nothing has run yet.
      </p>
      <div class="call-actions">
        <button type="button" class="btn btn-accent btn-sm" onClick={() => renderMessage(chatId, messageId)}>
          <PxIcon name="play" size={12} />
          Approve
        </button>
        <button type="button" class="btn btn-ghost btn-sm" onClick={() => declineRender(chatId, messageId)}>
          Not now
        </button>
      </div>
    </div>
  );
}
