import { useState } from 'react';
import { InstallManual } from './install-manual';
import type { SnippetContext } from './install-snippets';
import { InstallWithAi } from './install-with-ai';
import { cn } from '@/utils/cn';
import { trackFunnel } from '@/utils/funnel-tracking';

type InstallMethod = 'ai' | 'manual';
type ProjectType = 'website' | 'app' | 'backend';

const METHODS: { key: InstallMethod; label: string; hint: string }[] = [
  {
    key: 'ai',
    label: 'Install with AI',
    hint: 'Paste one prompt into your coding assistant',
  },
  {
    key: 'manual',
    label: 'Manual setup',
    hint: 'Copy the snippet for your framework',
  },
];

interface Props {
  projectId: string;
  projectName: string;
  projectTypes: ProjectType[];
  context: SnippetContext;
  defaultMethod?: InstallMethod;
}

/** The two ways to add the SDK, as a segmented switch. */
export function InstallGuide({
  projectId,
  projectName,
  projectTypes,
  context,
  defaultMethod = 'ai',
}: Props) {
  const [method, setMethod] = useState<InstallMethod>(defaultMethod);
  const [sessionReplayEnabled, setSessionReplayEnabled] = useState(false);
  const snippetContext = { ...context, sessionReplayEnabled };

  const select = (next: InstallMethod) => {
    trackFunnel('onboarding_install_method_selected', {
      projectId,
      method: next,
    });
    setMethod(next);
  };

  return (
    <div className="col gap-6">
      <div
        aria-label="Installation method"
        className="grid grid-cols-2 gap-1 rounded-xl bg-def-200 p-1 dark:bg-def-300"
        role="tablist"
      >
        {METHODS.map((item) => {
          const active = item.key === method;
          return (
            <button
              aria-controls={`install-${item.key}`}
              aria-selected={active}
              className={cn(
                'col items-start gap-0.5 rounded-lg px-4 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active
                  ? 'bg-background shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              id={`install-tab-${item.key}`}
              key={item.key}
              onClick={() => select(item.key)}
              role="tab"
              type="button"
            >
              <span className="font-medium">{item.label}</span>
              <span className="hidden text-muted-foreground text-xs sm:block">
                {item.hint}
              </span>
            </button>
          );
        })}
      </div>
      {projectTypes.includes('website') && (
        <div className="rounded-xl border p-4">
          <label className="row cursor-pointer items-center gap-3">
            <input
              checked={sessionReplayEnabled}
              className="size-4 accent-primary"
              onChange={(event) =>
                setSessionReplayEnabled(event.currentTarget.checked)
              }
              type="checkbox"
            />
            <span className="font-medium">
              Include session replay in the website setup
            </span>
          </label>
          <p className="mt-2 text-muted-foreground text-sm">
            When enabled, the generated setup records every session. OpenPanel
            masks text and input values by default.
          </p>
        </div>
      )}
      <div
        aria-labelledby={`install-tab-${method}`}
        id={`install-${method}`}
        role="tabpanel"
      >
        {method === 'ai' ? (
          <InstallWithAi
            context={snippetContext}
            projectId={projectId}
            projectName={projectName}
            projectTypes={projectTypes}
          />
        ) : (
          <InstallManual
            context={snippetContext}
            projectId={projectId}
            projectTypes={projectTypes}
          />
        )}
      </div>
    </div>
  );
}
