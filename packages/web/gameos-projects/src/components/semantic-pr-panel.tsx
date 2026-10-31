/**
 * SEMANTIC PULL REQUEST PANEL (presentational): the OPEN project's
 * semantic pull requests — one row per PR with its lifecycle status
 * (community's frozen state machine, reused verbatim) and its
 * change-kind summary line (git-lineage's frozen vocabulary order) —
 * plus the picked PR's full review detail and the review-action
 * buttons. The buttons are enabled EXACTLY per `legalTransitionsFor`
 * (the community machine's own legality); each dispatches one TYPED
 * intent through the command port — the community service owns
 * admission and its typed refusals surface verbatim (E8).
 */

import type { ReactNode } from "react";
import { TRANSITION_COMMANDS } from "../../../../community/src/index.ts";
import type {
  ContributionId,
  TransitionCommandKind,
} from "../../../../community/src/index.ts";
import type { ProjectsCommandIntent } from "../ports.ts";
import type { PullRequestsView } from "../view/semantic-pr-view.ts";
import { pullRequestsSummary } from "../view/semantic-pr-view.ts";
import { PROJECTS_EMPTY_STATE_COPY } from "../view/onboarding.ts";
import {
  pullRequestStatusStatus,
  transitionCommandStatus,
} from "../view/status.ts";
import { ChipList, DataTable, KeyValue, Mono, Panel } from "./primitives.tsx";
import { EmptySurface } from "./empty-surface.tsx";
import { StatusChip } from "./status-chip.tsx";
import { STYLE } from "./tokens.ts";

export interface SemanticPullRequestsPanelProps {
  /** The semantic-PR view of the open project (from the store projection). */
  readonly view: PullRequestsView;
  /** Dispatch one typed review intent (the host command port). */
  readonly onDispatchCommand: (intent: ProjectsCommandIntent) => void;
  /** Pick one pull request into the review detail. */
  readonly onSelectPullRequest: (prId: string) => void;
  /** The REAL next step of the no-PR state: one data-port pull. */
  readonly onRefresh?: () => void;
}

/** One review-action button: enabled exactly per the frozen legality. */
function ReviewActionButton({
  command,
  prId,
  legal,
  onDispatchCommand,
}: {
  readonly command: TransitionCommandKind;
  readonly prId: ContributionId;
  readonly legal: boolean;
  readonly onDispatchCommand: (intent: ProjectsCommandIntent) => void;
}): ReactNode {
  const status = transitionCommandStatus(command, legal);
  const style = legal ? STYLE.actionButton : STYLE.actionButtonDisabled;
  return (
    <button
      key={command}
      type="button"
      title={status.note}
      disabled={!legal}
      style={style}
      onClick={() => {
        if (!legal) return;
        onDispatchCommand({ kind: "transition-pull-request", prId, command });
      }}
    >
      {command}
    </button>
  );
}

/** The semantic pull requests surface. */
export function SemanticPullRequestsPanel({
  view,
  onDispatchCommand,
  onSelectPullRequest,
  onRefresh,
}: SemanticPullRequestsPanelProps): ReactNode {
  if (view.totalPullRequests === 0) {
    return (
      <Panel title="Pull Requests" summary={pullRequestsSummary(view)}>
        <EmptySurface copy={PROJECTS_EMPTY_STATE_COPY["pull-requests"]} onNextStep={onRefresh} />
      </Panel>
    );
  }
  const detail = view.selected;
  return (
    <Panel title="Pull Requests" summary={pullRequestsSummary(view)}>
      <DataTable
        columns={[
          {
            key: "title",
            header: "Pull request",
            render: (row) => (
              <span style={STYLE.chipRow}>
                <span style={{ fontWeight: 600 }}>{row.title}</span>
                <Mono>{row.prId}</Mono>
              </span>
            ),
          },
          { key: "author", header: "Author", render: (row) => <Mono>{row.author}</Mono> },
          {
            key: "status",
            header: "Lifecycle",
            render: (row) => <StatusChip status={pullRequestStatusStatus(row.status)} />,
          },
          {
            key: "refs",
            header: "Refs",
            render: (row) => (
              <Mono>
                {row.baseRef}…{row.headRef}
              </Mono>
            ),
          },
          {
            key: "changes",
            header: "Change kinds",
            render: (row) => <span style={STYLE.muted}>{row.changeKindLine}</span>,
          },
          { key: "subjects", header: "Subjects", render: (row) => <Mono>{row.subjectCount}</Mono> },
          {
            key: "open",
            header: "Review",
            render: (row) => (
              <button
                type="button"
                style={STYLE.selectButton}
                onClick={() => {
                  onSelectPullRequest(row.prKey);
                }}
              >
                open review
              </button>
            ),
          },
        ]}
        rows={view.rows}
        rowKey={(row) => row.prKey}
        empty="no pull requests"
      />
      {detail === null ? (
        <p style={{ ...STYLE.muted, margin: "12px 0 0", fontSize: 12.5, fontStyle: "italic" }}>
          no pull request picked — open a review to inspect its change kinds and dispatch typed
          review intents
        </p>
      ) : (
        <>
          <KeyValue
            entries={[
              { key: "Pull request", value: <Mono>{detail.prId}</Mono> },
              { key: "Title", value: <span style={STYLE.muted}>{detail.title}</span> },
              { key: "Author", value: <Mono>{detail.author}</Mono> },
              {
                key: "Lifecycle",
                value: <StatusChip status={pullRequestStatusStatus(detail.status)} />,
              },
              {
                key: "Refs",
                value: (
                  <Mono>
                    {detail.baseRef}…{detail.headRef}
                  </Mono>
                ),
              },
              { key: "Subjects touched", value: <Mono>{detail.subjectCount}</Mono> },
              { key: "Semantic diff", value: <Mono>{detail.semanticDiffId}</Mono> },
            ]}
          />
          <ChipList
            label="Change kinds (frozen vocabulary order)"
            chips={detail.changeKindCounts.map((entry) => (
              <StatusChip
                key={entry.kind}
                status={{
                  label: `${entry.count} ${entry.kind}`,
                  tone: "info",
                  note: "git-lineage semantic change kind (verbatim vocabulary)",
                }}
              />
            ))}
            empty="no classified changes"
          />
          <div style={STYLE.chipRow}>
            {TRANSITION_COMMANDS.map((command) => (
              <ReviewActionButton
                key={command}
                command={command}
                prId={detail.prId}
                legal={detail.legalTransitions.includes(command)}
                onDispatchCommand={onDispatchCommand}
              />
            ))}
          </div>
          <p style={{ ...STYLE.faint, margin: 0, fontSize: 11.5 }}>
            Review actions are typed intents; legality is community's frozen state machine
            (submitted → triaged → under-review → verdicts; terminal, E10). Disabled commands are
            not legal from the current status.
          </p>
        </>
      )}
    </Panel>
  );
}
