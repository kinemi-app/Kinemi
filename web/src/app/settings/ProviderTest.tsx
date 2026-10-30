// The chat card's test row: send a test message to the chosen assistant, or say why it can't answer yet.
import { ASSISTANTS, assistantProblem, testAssistant } from '../chat/llm';
import { refreshLocal } from '../local';
import type { Assistant } from '../store';
import { PxIcon } from '../ui/icons';
import { toast } from '../ui/toast';
import { Result } from './parts';

/** The last test's outcome; reset to null whenever the assistant changes. */
export type TestState = { ok: boolean; text: string } | 'busy' | null;

type Props = {
  provider: Exclude<Assistant, 'builtin'>;
  /** The assistant picked in Settings, whose problem (a missing key, an absent CLI) blocks the test. */
  chosen: Assistant;
  test: TestState;
  onTest: (next: TestState) => void;
};

export function ProviderTest({ provider, chosen, test, onTest }: Props) {
  const isCli = provider === 'claude-code' || provider === 'codex';
  const problem = assistantProblem(chosen);
  const send = async () => {
    onTest('busy');
    const r = await testAssistant(provider);
    onTest(r);
    if (r.ok) toast({ title: `${ASSISTANTS[provider].name} answers`, body: r.text });
  };
  return (
    <>
      {problem ? (
        <p class="set-help is-warn">
          <PxIcon name="info" size={12} /> {problem}
        </p>
      ) : (
        <div class="set-actions">
          <button type="button" class="btn btn-sm btn-ghost" disabled={test === 'busy'} onClick={send}>
            <PxIcon name="bolt" size={12} />
            Send a test message
          </button>
          {isCli && (
            <button type="button" class="btn btn-sm btn-ghost" onClick={() => void refreshLocal()}>
              <PxIcon name="refresh" size={12} />
              Look again
            </button>
          )}
        </div>
      )}
      {test && test !== 'busy' && <Result check={test.ok ? { ok: true, title: 'It answers', lines: [test.text] } : { ok: false, title: 'No answer', body: test.text }} />}
      {test === 'busy' && <Result check="busy" />}
    </>
  );
}
