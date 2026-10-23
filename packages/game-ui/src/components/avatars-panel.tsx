/**
 * AVATARS PANEL (presentational): renders the avatar read model
 * (view/avatar-view.ts) — one inspector card per composed AvatarDefinition
 * with sub-record version stamps, referenced packages, sensor channels,
 * effective-capability chips (host restriction applied, R5) and served
 * intent kinds (PL-026). Host-denied capabilities are surfaced once at the
 * top of the surface.
 *
 * Presentational component: renders `AvatarsView` only; selection flows out
 * through the optional `onSelectAvatar` callback; no data fetching.
 */

import type { ReactNode } from "react";
import type { AvatarCardView, AvatarsView } from "../view/avatar-view.ts";
import { avatarsSummary } from "../view/avatar-view.ts";
import { STUDIO_EMPTY_STATE_COPY } from "../view/onboarding.ts";
import { StatusChip } from "./status-chip.tsx";
import { Banner, ChipList, DataTable, KeyValue, Mono, Panel } from "./primitives.tsx";
import { EmptySurface } from "./empty-surface.tsx";
import { STYLE } from "./tokens.ts";

function AvatarCard({
  card,
  selected,
  onSelect,
}: {
  readonly card: AvatarCardView;
  readonly selected: boolean;
  readonly onSelect?: (avatarId: string) => void;
}): ReactNode {
  return (
    <article style={selected ? STYLE.cardSelected : STYLE.card}>
      <div style={{ ...STYLE.chipRow, justifyContent: "space-between" }}>
        {onSelect === undefined ? (
          <strong style={{ ...STYLE.mono, fontSize: 13 }}>{card.avatarId}</strong>
        ) : (
          <button type="button" style={STYLE.selectButton} onClick={() => onSelect(card.avatarId)}>
            {card.avatarId}
          </button>
        )}
        <span style={STYLE.muted}>
          {card.agent === null ? "no agent bound" : <>agent <Mono>{card.agent}</Mono></>}
        </span>
      </div>
      <KeyValue
        entries={[
          { key: "definition digest", value: <Mono>{card.definitionDigest}</Mono> },
          { key: "skills", value: `${String(card.skillCount)} referenced skill package${card.skillCount === 1 ? "" : "s"}` },
        ]}
      />
      <DataTable
        columns={[
          { key: "subRecord", header: "sub-record", render: (row) => <Mono>{row.subRecord}</Mono> },
          { key: "version", header: "version", render: (row) => <Mono>v{String(row.version)}</Mono> },
          { key: "revisionDigest", header: "revision digest", render: (row) => <Mono>{row.revisionDigest}</Mono> },
        ]}
        rows={card.subRecords}
        rowKey={(row) => row.subRecord}
        empty="no sub-records"
      />
      <DataTable
        columns={[
          { key: "role", header: "package ref", render: (row) => <Mono>{row.role}</Mono> },
          { key: "packageId", header: "package", render: (row) => <Mono>{row.packageId}</Mono> },
          { key: "version", header: "version", render: (row) => <Mono>{row.version}</Mono> },
          { key: "digest", header: "digest", render: (row) => (row.digest === null ? "—" : <Mono>{row.digest}</Mono>) },
        ]}
        rows={card.packageRefs}
        rowKey={(row) => `${row.role}-${row.packageId}`}
        empty="no referenced packages"
      />
      <div style={STYLE.chipRow}>
        {card.sensors.map((sensor) => (
          <span key={sensor.channel} style={{ ...STYLE.mono, fontSize: 11.5, color: STYLE.muted.color }}>
            sensor <span style={{ color: "#2dd4bf" }}>{sensor.capability}</span> · {sensor.channel}
          </span>
        ))}
      </div>
      <ChipList
        label="effective capabilities (host restriction applied)"
        chips={card.capabilities.map((chip) => (
          <StatusChip key={chip.capability} status={chip.status}>
            <span style={{ fontWeight: 400, opacity: 0.75 }}>{chip.capability} · {chip.surface}</span>
          </StatusChip>
        ))}
        empty="no capabilities"
      />
      <ChipList
        label="served intent kinds (body gate)"
        chips={card.servedIntents.map((chip) => (
          <StatusChip key={chip.intentKind} status={chip.status}>
            <span style={{ fontWeight: 400, opacity: 0.75 }}>{chip.intentKind}</span>
          </StatusChip>
        ))}
        empty="no served intents"
      />
    </article>
  );
}

/** The Avatars surface: denied-capability banner + avatar inspector cards. */
export function AvatarsPanel({
  view,
  selectedAvatarId,
  onSelectAvatar,
  onRefresh,
}: {
  readonly view: AvatarsView;
  readonly selectedAvatarId?: string | null;
  readonly onSelectAvatar?: (avatarId: string) => void;
  /** The REAL next step of the first-run empty state: one port pull. */
  readonly onRefresh?: () => void;
}): ReactNode {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {view.deniedCapabilities.length === 0 ? null : (
        <Banner tone="error">
          host-denied capabilities (R5): {view.deniedCapabilities.join(", ")}
        </Banner>
      )}
      <Panel title="Avatars" summary={avatarsSummary(view)}>
        {view.cards.length === 0 ? (
          <EmptySurface copy={STUDIO_EMPTY_STATE_COPY.avatars} onNextStep={onRefresh} />
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {view.cards.map((card) => (
              <AvatarCard
                key={card.avatarId}
                card={card}
                selected={card.avatarId === selectedAvatarId}
                onSelect={onSelectAvatar}
              />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
