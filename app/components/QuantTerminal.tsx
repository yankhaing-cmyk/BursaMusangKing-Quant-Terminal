"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  DashboardSnapshot,
  QuantRow,
  RankingQuery,
  ResearchSnapshot,
} from "@/app/lib/types";

type Tab = "today" | "ranking" | "regime" | "research" | "health";
type Sort = NonNullable<RankingQuery["sort"]>;

const RUN_GATEWAY_URL = "https://bursa-quant-run-gateway.yankhaing.workers.dev/run";
const RUN_KEY_STORAGE = "bmk-quant-manual-run-key";

const scoreFields: Array<[keyof QuantRow, string, string]> = [
  ["trendScore", "Trend", "20%"],
  ["momentumScore", "Momentum", "20%"],
  ["relativeStrengthScore", "Relative strength", "20%"],
  ["volumeScore", "Volume", "10%"],
  ["volatilityScore", "Volatility / risk", "10%"],
  ["liquidityScore", "Liquidity", "10%"],
  ["strategyEnsembleScore", "Strategy ensemble", "10%"],
];

const sortLabels: Record<Sort, string> = {
  score: "Quant Score",
  trend: "Trend",
  momentum: "Momentum",
  rs: "Relative Strength",
  liquidity: "Liquidity",
  symbol: "Code",
};

function formatPrice(value: number): string {
  return value < 1 ? value.toFixed(3) : value.toFixed(2);
}

function formatPercent(value: number | null): string {
  if (value === null) return "—";
  const percentage = value * 100;
  return `${percentage > 0 ? "+" : ""}${percentage.toFixed(1)}%`;
}

function compactMoney(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-MY", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function scoreTone(score: number): string {
  if (score >= 85) return "score-elite";
  if (score >= 70) return "score-strong";
  if (score >= 55) return "score-neutral";
  return "score-weak";
}

function regimeTone(label: string): string {
  if (label === "STRONG RISK-ON") return "regime-strong-on";
  if (label === "RISK-ON") return "regime-on";
  if (label === "RISK-OFF") return "regime-off";
  if (label === "STRONG RISK-OFF") return "regime-strong-off";
  return "regime-neutral";
}

function ScoreBadge({ value, large = false }: { value: number; large?: boolean }) {
  return (
    <span className={`score-badge ${scoreTone(value)} ${large ? "score-badge-large" : ""}`}>
      {value.toFixed(1)}
    </span>
  );
}

function MiniBar({ value }: { value: number }) {
  return (
    <span className="mini-bar" aria-label={`${value.toFixed(1)} out of 100`}>
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </span>
  );
}

function EmptyLiveNotice() {
  return (
    <div className="sample-notice" role="status">
      <span className="sample-notice-icon">!</span>
      <span>
        <strong>Illustrative interface only.</strong> These DEMO counters are not Bursa market data,
        recommendations, or trade signals. A verified run will replace them automatically.
      </span>
    </div>
  );
}

function Header({
  snapshot,
  onTheme,
  onRun,
  runState,
  theme,
}: {
  snapshot: DashboardSnapshot;
  onTheme: () => void;
  onRun: () => void;
  runState: "idle" | "queuing" | "queued";
  theme: "dark" | "light";
}) {
  const live = snapshot.mode === "LIVE";
  return (
    <header className="terminal-header">
      <div className="brand-lockup">
        <span className="brand-mark" aria-hidden="true">
          BMK
        </span>
        <div>
          <p className="eyebrow">BURSA MALAYSIA · QUANT</p>
          <h1>MusangKing Terminal</h1>
        </div>
      </div>
      <div className="header-actions">
        <button
          className={`run-button ${runState === "queued" ? "is-queued" : ""}`}
          type="button"
          onClick={onRun}
          disabled={runState === "queuing"}
          aria-label="Run full Bursa screening"
        >
          <span aria-hidden="true">{runState === "queuing" ? "…" : runState === "queued" ? "✓" : "▶"}</span>
          {runState === "queuing" ? "QUEUE" : runState === "queued" ? "QUEUED" : "RUN"}
        </button>
        <div className={`live-state ${live ? "is-live" : "is-demo"}`}>
          <span aria-hidden="true" />
          {live ? snapshot.run.marketDate : "NOT LIVE"}
        </div>
        <button className="icon-button" type="button" onClick={onTheme} aria-label="Toggle day or night theme">
          {theme === "dark" ? "☀" : "☾"}
        </button>
      </div>
    </header>
  );
}

function TodayView({ snapshot, onInspect }: { snapshot: DashboardSnapshot; onInspect: (row: QuantRow) => void }) {
  const top = snapshot.rows.slice(0, 5);
  const live = snapshot.mode === "LIVE";
  return (
    <div className="view-stack">
      {!live && <EmptyLiveNotice />}
      <section className="status-hero">
        <div>
          <p className="section-kicker">DAILY STATE</p>
          <div className="status-line">
            <span className={`status-orb ${live ? "good" : "blocked"}`} />
            <h2>{live ? "Verified universe active" : "Publication gate closed"}</h2>
          </div>
          <p className="muted">
            {live
              ? `${snapshot.run.validSymbols} stocks scored against FBM KLCI for ${snapshot.run.marketDate}.`
              : "No verified full-universe run is connected. The application will not invent a production state."}
          </p>
        </div>
        <div className="hero-stamp">
          <span>MODEL</span>
          <strong>{snapshot.run.modelVersion.replace("quant-", "").toUpperCase()}</strong>
        </div>
      </section>

      <section className="metric-grid" aria-label="Quant overview">
        <article className="metric-card">
          <span>VALID STOCKS</span>
          <strong>{live ? snapshot.run.validSymbols.toLocaleString() : "—"}</strong>
          <small>Minimum gate 900</small>
        </article>
        <article className="metric-card">
          <span>SCORE ≥ 80</span>
          <strong>{live ? snapshot.highScoreCount : "—"}</strong>
          <small>Research candidates</small>
        </article>
        <article className="metric-card">
          <span>UNIVERSE MEAN</span>
          <strong>{live && snapshot.universeMeanScore !== null ? snapshot.universeMeanScore.toFixed(1) : "—"}</strong>
          <small>Cross-sectional score</small>
        </article>
        <article className="metric-card">
          <span>MARKET REGIME</span>
          <strong className={`metric-word ${snapshot.marketRegime ? regimeTone(snapshot.marketRegime.label) : ""}`}>
            {live ? snapshot.marketRegime?.label ?? "AWAITING RUN" : "—"}
          </strong>
          <small>{snapshot.marketRegime ? `Score ${snapshot.marketRegime.score.toFixed(1)}` : "Phase 3 gate"}</small>
        </article>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">TOP RANKED</p>
            <h2>{live ? "Highest Quant Scores" : "Sample score anatomy"}</h2>
          </div>
          <span className="panel-meta">{live ? snapshot.run.marketDate : "DEMO"}</span>
        </div>
        <div className="candidate-list">
          {top.map((row) => (
            <button className="candidate-row" key={row.symbol} type="button" onClick={() => onInspect(row)}>
              <span className="candidate-rank">{String(row.rank).padStart(2, "0")}</span>
              <span className="candidate-name">
                <strong>{row.symbol}</strong>
                <small>{row.name}</small>
              </span>
              <span className="candidate-factor">
                <small>Trend</small>
                <strong>{row.trendScore.toFixed(0)}</strong>
              </span>
              <span className="candidate-factor candidate-factor-mobile-hide">
                <small>RS</small>
                <strong>{row.relativeStrengthScore.toFixed(0)}</strong>
              </span>
              <ScoreBadge value={row.quantScore} />
              <span className="row-chevron" aria-hidden="true">›</span>
            </button>
          ))}
        </div>
      </section>

      <section className="two-column">
        <article className="panel compact-panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">MODEL CONTROL</p>
              <h2>Explainable by design</h2>
            </div>
          </div>
          <div className="guard-list">
            <div><span>Fixed weights</span><strong>100%</strong></div>
            <div><span>Required benchmark</span><strong>FBMKLCI</strong></div>
            <div><span>Partial publish</span><strong className="negative">BLOCKED</strong></div>
            <div><span>ML layer</span><strong>OFF</strong></div>
            <div><span>Regime model</span><strong>{snapshot.marketRegime ? "ACTIVE" : "AWAITING RUN"}</strong></div>
          </div>
        </article>
        <article className="panel compact-panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">PHASE 2 RESEARCH</p>
              <h2>Expected edge</h2>
            </div>
            <span className="phase-pill">PHASE 2</span>
          </div>
          <p className="empty-copy">
            The forward-outcome collector is active. Estimates remain hidden until each score bucket has a sufficient real sample.
          </p>
        </article>
      </section>
    </div>
  );
}

function RegimeView({ snapshot }: { snapshot: DashboardSnapshot }) {
  const regime = snapshot.marketRegime;
  const live = snapshot.mode === "LIVE";
  if (!regime) {
    return (
      <div className="view-stack">
        {!live && <EmptyLiveNotice />}
        <section className="research-hero regime-empty">
          <div>
            <p className="section-kicker">PHASE 3 · MARKET REGIME</p>
            <h2>Awaiting the next verified screening run</h2>
            <p className="muted">
              Existing rankings remain valid. A regime will appear only when KLCI trend, full-universe breadth,
              sector breadth, participation and volatility pass together.
            </p>
          </div>
          <span className="research-state">FAIL CLOSED</span>
        </section>
      </div>
    );
  }
  const components = [
    ["KLCI trend", regime.benchmarkTrendScore, "35%"],
    ["Market breadth", regime.breadthScore, "35%"],
    ["Sector breadth", regime.sectorBreadthScore, "10%"],
    ["Participation", regime.participationScore, "10%"],
    ["Volatility", regime.volatilityScore, "10%"],
  ] as const;
  return (
    <div className="view-stack">
      {!live && <EmptyLiveNotice />}
      <section className={`regime-hero ${regimeTone(regime.label)}`}>
        <div>
          <p className="section-kicker">PHASE 3 · MARKET REGIME</p>
          <h2>{regime.label}</h2>
          <p className="muted">
            Point-in-time Bursa state for {regime.marketDate}. Guidance is risk control, not an order to trade.
          </p>
        </div>
        <div className="regime-score"><span>REGIME SCORE</span><strong>{regime.score.toFixed(1)}</strong></div>
      </section>

      <section className="metric-grid" aria-label="Regime policy guidance">
        <article className="metric-card"><span>MIN QUANT SCORE</span><strong>{regime.minimumQuantScore}</strong><small>New candidate threshold</small></article>
        <article className="metric-card"><span>MAX EXPOSURE</span><strong>{formatPercent(regime.maxEquityExposure)}</strong><small>Portfolio ceiling</small></article>
        <article className="metric-card"><span>CASH FLOOR</span><strong>{formatPercent(regime.minimumCashAllocation)}</strong><small>Minimum allocation</small></article>
        <article className="metric-card"><span>NEW POSITION</span><strong>{regime.newPositionSizeMultiplier.toFixed(2)}×</strong><small>Rule-based size multiplier</small></article>
      </section>

      <section className="two-column regime-columns">
        <article className="panel">
          <div className="panel-heading"><div><p className="section-kicker">MODEL BRIDGE</p><h2>Five transparent components</h2></div><span className="phase-pill">NO ML</span></div>
          <div className="regime-components">
            {components.map(([label, value, weight]) => (
              <div className="bridge-row" key={label}>
                <span>{label}<small>{weight}</small></span><MiniBar value={value} /><strong>{value.toFixed(1)}</strong>
              </div>
            ))}
          </div>
        </article>
        <article className="panel">
          <div className="panel-heading"><div><p className="section-kicker">MARKET EVIDENCE</p><h2>Breadth and risk</h2></div></div>
          <div className="health-list regime-evidence">
            <div><span>Stocks above 20DMA</span><strong>{formatPercent(regime.breadthAbove20)}</strong></div>
            <div><span>Stocks above 50DMA</span><strong>{formatPercent(regime.breadthAbove50)}</strong></div>
            <div><span>Stocks above 200DMA</span><strong>{formatPercent(regime.breadthAbove200)}</strong></div>
            <div><span>Positive sector breadth</span><strong>{formatPercent(regime.sectorPositiveRate)}</strong></div>
            <div><span>Volume participation</span><strong>{formatPercent(regime.volumeParticipationRate)}</strong></div>
            <div><span>New highs / lows</span><strong>{formatPercent(regime.newHighRate)} / {formatPercent(regime.newLowRate)}</strong></div>
            <div><span>KLCI 20D return</span><strong>{formatPercent(regime.benchmarkReturn20)}</strong></div>
            <div><span>KLCI realized volatility</span><strong>{formatPercent(regime.benchmarkRealizedVolatility20)}</strong></div>
          </div>
        </article>
      </section>

      <section className="panel compact-panel regime-policy-panel">
        <div className="panel-heading"><div><p className="section-kicker">RISK POLICY</p><h2>Regime-aware operating limits</h2></div><span className="panel-meta">{regime.methodologyVersion}</span></div>
        <div className="acceptance-grid regime-policy-grid">
          <div><span>New entries</span><strong>{regime.maxNewEntries} maximum</strong></div>
          <div><span>Trend emphasis</span><strong>{regime.trendWeightMultiplier.toFixed(2)}× research modifier</strong></div>
          <div><span>Quant Score formula</span><strong>UNCHANGED</strong></div>
          <div><span>Automatic execution</span><strong className="negative">OFF</strong></div>
        </div>
      </section>
    </div>
  );
}

function RankingView({
  snapshot,
  onInspect,
  query,
  setQuery,
  page,
  setPage,
  loading,
}: {
  snapshot: DashboardSnapshot;
  onInspect: (row: QuantRow) => void;
  query: { search: string; sector: string; minimumScore: number; sort: Sort };
  setQuery: (next: { search: string; sector: string; minimumScore: number; sort: Sort }) => void;
  page: number;
  setPage: (page: number) => void;
  loading: boolean;
}) {
  const pageSize = 100;
  const totalPages = Math.max(1, Math.ceil(snapshot.totalRows / pageSize));
  const visibleRows = useMemo(() => {
    if (snapshot.mode === "LIVE") return snapshot.rows;
    const search = query.search.toLowerCase();
    return snapshot.rows
      .filter((row) => !search || `${row.symbol} ${row.name}`.toLowerCase().includes(search))
      .filter((row) => !query.sector || row.sector === query.sector)
      .filter((row) => row.quantScore >= query.minimumScore)
      .sort((left, right) => {
        const values: Record<Sort, [number | string, number | string]> = {
          score: [left.quantScore, right.quantScore],
          trend: [left.trendScore, right.trendScore],
          momentum: [left.momentumScore, right.momentumScore],
          rs: [left.relativeStrengthScore, right.relativeStrengthScore],
          liquidity: [left.liquidityScore, right.liquidityScore],
          symbol: [left.symbol, right.symbol],
        };
        const [a, b] = values[query.sort];
        return typeof a === "string" && typeof b === "string" ? a.localeCompare(b) : Number(b) - Number(a);
      });
  }, [snapshot, query]);

  return (
    <div className="view-stack">
      {snapshot.mode !== "LIVE" && <EmptyLiveNotice />}
      <section className="ranking-header">
        <div>
          <p className="section-kicker">FULL BURSA UNIVERSE</p>
          <h2>Daily Quant Ranking</h2>
          <p className="muted">
            Every eligible stock receives the same transparent, versioned scoring treatment.
          </p>
        </div>
        <div className="ranking-count">
          <strong>{snapshot.mode === "LIVE" ? snapshot.totalRows.toLocaleString() : "12 sample"}</strong>
          <span>{loading ? "Refreshing…" : "counters"}</span>
        </div>
      </section>
      <section className="filter-bar" aria-label="Ranking filters">
        <label className="search-field">
          <span aria-hidden="true">⌕</span>
          <input
            value={query.search}
            onChange={(event) => {
              setPage(1);
              setQuery({ ...query, search: event.target.value });
            }}
            placeholder="Code or company"
            aria-label="Search code or company"
          />
        </label>
        <label>
          <span className="sr-only">Sector</span>
          <select
            value={query.sector}
            onChange={(event) => {
              setPage(1);
              setQuery({ ...query, sector: event.target.value });
            }}
          >
            <option value="">All sectors</option>
            {snapshot.sectors.map((sector) => <option key={sector} value={sector}>{sector}</option>)}
          </select>
        </label>
        <label>
          <span className="sr-only">Minimum score</span>
          <select
            value={query.minimumScore}
            onChange={(event) => {
              setPage(1);
              setQuery({ ...query, minimumScore: Number(event.target.value) });
            }}
          >
            <option value={0}>All scores</option>
            <option value={60}>Score ≥ 60</option>
            <option value={70}>Score ≥ 70</option>
            <option value={80}>Score ≥ 80</option>
            <option value={85}>Score ≥ 85</option>
            <option value={90}>Score ≥ 90</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Sort ranking</span>
          <select value={query.sort} onChange={(event) => setQuery({ ...query, sort: event.target.value as Sort })}>
            {Object.entries(sortLabels).map(([value, label]) => <option key={value} value={value}>Sort: {label}</option>)}
          </select>
        </label>
      </section>

      <section className={`ranking-panel ${loading ? "is-loading" : ""}`}>
        <div className="ranking-table-header" aria-hidden="true">
          <span>RANK / COUNTER</span><span>PRICE</span><span>TREND</span><span>MOM</span><span>RS</span><span>LIQ</span><span>QUANT</span><span />
        </div>
        <div className="ranking-rows">
          {visibleRows.map((row) => (
            <button className="ranking-row" key={row.symbol} type="button" onClick={() => onInspect(row)}>
              <span className="stock-cell">
                <em>{String(row.rank).padStart(3, "0")}</em>
                <span><strong>{row.symbol}</strong><small>{row.name}</small><small className="sector-label">{row.sector}</small></span>
              </span>
              <span className="price-cell"><strong>{formatPrice(row.close)}</strong><small>RM</small></span>
              <span className="factor-cell"><strong>{row.trendScore.toFixed(0)}</strong><MiniBar value={row.trendScore} /></span>
              <span className="factor-cell"><strong>{row.momentumScore.toFixed(0)}</strong><MiniBar value={row.momentumScore} /></span>
              <span className="factor-cell"><strong>{row.relativeStrengthScore.toFixed(0)}</strong><MiniBar value={row.relativeStrengthScore} /></span>
              <span className="factor-cell liquidity-column"><strong>{row.liquidityScore.toFixed(0)}</strong><MiniBar value={row.liquidityScore} /></span>
              <ScoreBadge value={row.quantScore} />
              <span className="row-chevron" aria-hidden="true">›</span>
            </button>
          ))}
          {!visibleRows.length && <div className="no-results">No counters match these filters.</div>}
        </div>
        {snapshot.mode === "LIVE" && snapshot.totalRows > pageSize && (
          <div className="pagination">
            <button type="button" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Previous</button>
            <span>Page {page} of {totalPages}</span>
            <button type="button" disabled={page >= totalPages || loading} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        )}
      </section>
    </div>
  );
}

function HealthView({ snapshot }: { snapshot: DashboardSnapshot }) {
  const live = snapshot.mode === "LIVE";
  const hash = snapshot.run.payloadHash;
  const rows = [
    ["Publication gate", live ? "ACTIVE" : "CLOSED", live ? "good-text" : "negative"],
    ["Latest market date", snapshot.run.marketDate ?? "No verified date", ""],
    ["FBM KLCI date", snapshot.run.benchmarkDate ?? "Missing", live ? "" : "negative"],
    ["Valid universe", live ? `${snapshot.run.validSymbols} / ${snapshot.run.totalInstruments}` : "0 live", ""],
    ["Minimum universe", "900", ""],
    ["Data provider", snapshot.run.provider, ""],
    ["Model version", snapshot.run.modelVersion, ""],
    ["Last successful run", snapshot.run.committedAt ?? "None", ""],
    ["Payload hash", hash ? `${hash.slice(0, 12)}…${hash.slice(-8)}` : "None", "mono"],
  ];
  return (
    <div className="view-stack">
      <section className="health-hero">
        <div className={`health-icon ${live ? "healthy" : "blocked"}`}>{live ? "✓" : "!"}</div>
        <div>
          <p className="section-kicker">SYSTEM HEALTH</p>
          <h2>{live ? "Verified daily state is active" : "Safe: no unverified data published"}</h2>
          <p className="muted">
            {live
              ? "The browser is reading one fully committed, checksum-verified run."
              : "Fail-closed behavior is working. Sample rows remain clearly separated from production data."}
          </p>
        </div>
      </section>
      <section className="two-column health-columns">
        <article className="panel">
          <div className="panel-heading"><div><p className="section-kicker">ACTIVE RUN</p><h2>Data integrity</h2></div></div>
          <div className="health-list">
            {rows.map(([label, value, tone]) => (
              <div key={label}><span>{label}</span><strong className={tone}>{value}</strong></div>
            ))}
          </div>
        </article>
        <article className="panel">
          <div className="panel-heading"><div><p className="section-kicker">WARNINGS</p><h2>Validation log</h2></div><span className="issue-count">{snapshot.issues.length}</span></div>
          <div className="issue-list">
            {snapshot.issues.map((issue, index) => (
              <div className="issue" key={`${issue.code}-${index}`}>
                <span className={issue.severity === "CRITICAL" ? "critical" : "warning"}>{issue.severity}</span>
                <div><strong>{issue.code}</strong><p>{issue.detail}</p></div>
              </div>
            ))}
            {!snapshot.issues.length && <p className="empty-copy">No active-run warnings.</p>}
          </div>
        </article>
      </section>
      <section className="panel">
        <div className="panel-heading"><div><p className="section-kicker">PRODUCTION ACCEPTANCE</p><h2>Phase 1 gate</h2></div><span className="phase-pill">LOCKED</span></div>
        <div className="acceptance-grid">
          {["10 Bursa shadow dates", "≥900 valid counters", "Point-in-time reconciliation", "Conflicting payload rejection", "Android light/dark QA", "Secrets and rollback audit"].map((item) => (
            <div key={item}><span className="unchecked" aria-hidden="true" />{item}</div>
          ))}
        </div>
      </section>
    </div>
  );
}

const researchBuckets = ["95-100", "90-94", "85-89", "80-84", "70-79", "60-69", "50-59", "0-49"];
const researchHorizons = [5, 10, 20, 60];

function ResearchView({ research }: { research: ResearchSnapshot }) {
  const statistic = (bucket: string, horizon: number) =>
    research.statistics.find(
      (row) => row.scoreBucket === bucket && row.horizon === horizon,
    );
  const established = research.statistics.filter(
    (row) => row.sampleSize >= research.establishedSample,
  ).length;
  const provisional = research.statistics.filter(
    (row) =>
      row.sampleSize >= research.minimumSample &&
      row.sampleSize < research.establishedSample,
  ).length;
  return (
    <div className="view-stack">
      <section className="research-hero">
        <div>
          <p className="section-kicker">PHASE 2 · EXPECTED EDGE</p>
          <h2>{research.observationCount ? "Forward outcomes are accumulating" : "Research collection is active"}</h2>
          <p className="muted">
            Next-session open to the 5D, 10D, 20D and 60D closing price. Price return only; dividends are excluded.
          </p>
        </div>
        <span className="research-state">{research.observationCount ? "COLLECTING" : "AWAITING 5D"}</span>
      </section>

      <section className="metric-grid research-metrics" aria-label="Research collection overview">
        <article className="metric-card"><span>SCORE DATES</span><strong>{research.scoreDates}</strong><small>Immutable daily snapshots</small></article>
        <article className="metric-card"><span>OBSERVATIONS</span><strong>{research.observationCount.toLocaleString()}</strong><small>Matured symbol-horizons</small></article>
        <article className="metric-card"><span>PROVISIONAL CELLS</span><strong>{provisional}</strong><small>Sample size 30–99</small></article>
        <article className="metric-card"><span>ESTABLISHED CELLS</span><strong>{established}</strong><small>Sample size ≥100</small></article>
      </section>

      <section className="panel research-panel">
        <div className="panel-heading">
          <div><p className="section-kicker">SCORE-BUCKET MATRIX</p><h2>Historical forward outcomes</h2></div>
          <span className="phase-pill">NO ML</span>
        </div>
        <div className="research-table" role="table" aria-label="Quant score forward outcome statistics">
          <div className="research-row research-header" role="row">
            <span role="columnheader">SCORE</span>
            {researchHorizons.map((horizon) => <span role="columnheader" key={horizon}>{horizon}D</span>)}
          </div>
          {researchBuckets.map((bucket) => (
            <div className="research-row" role="row" key={bucket}>
              <strong role="rowheader">{bucket}</strong>
              {researchHorizons.map((horizon) => {
                const row = statistic(bucket, horizon);
                if (!row || row.sampleSize < research.minimumSample) {
                  return (
                    <span className="research-cell collecting" role="cell" key={horizon}>
                      <strong>COLLECTING</strong><small>n={row?.sampleSize ?? 0}</small>
                    </span>
                  );
                }
                const tone = row.sampleSize >= research.establishedSample ? "established" : "provisional";
                return (
                  <span className={`research-cell ${tone}`} role="cell" key={horizon}>
                    <strong>{formatPercent(row.averageReturn)}</strong>
                    <small>{(row.winRate * 100).toFixed(0)}% win · n={row.sampleSize}</small>
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      <section className="panel research-panel">
        <div className="panel-heading">
          <div><p className="section-kicker">REGIME MATRIX</p><h2>Forward outcomes by market state</h2></div>
          <span className="phase-pill">PHASE 3</span>
        </div>
        <div className="research-table regime-research-table" role="table" aria-label="Market regime forward outcome statistics">
          <div className="research-row research-header" role="row">
            <span role="columnheader">REGIME</span>
            {researchHorizons.map((horizon) => <span role="columnheader" key={horizon}>{horizon}D</span>)}
          </div>
          {["STRONG RISK-ON", "RISK-ON", "NEUTRAL", "RISK-OFF", "STRONG RISK-OFF"].map((label) => (
            <div className="research-row" role="row" key={label}>
              <strong className={regimeTone(label)} role="rowheader">{label}</strong>
              {researchHorizons.map((horizon) => {
                const row = research.regimeStatistics.find(
                  (item) => item.regimeLabel === label && item.horizon === horizon,
                );
                if (!row || row.sampleSize < research.minimumSample) {
                  return <span className="research-cell collecting" role="cell" key={horizon}><strong>COLLECTING</strong><small>n={row?.sampleSize ?? 0}</small></span>;
                }
                const tone = row.sampleSize >= research.establishedSample ? "established" : "provisional";
                return <span className={`research-cell ${tone}`} role="cell" key={horizon}><strong>{formatPercent(row.averageReturn)}</strong><small>{(row.winRate * 100).toFixed(0)}% win · n={row.sampleSize}</small></span>;
              })}
            </div>
          ))}
        </div>
      </section>

      <section className="two-column">
        <article className="panel compact-panel">
          <div className="panel-heading"><div><p className="section-kicker">CONFIDENCE POLICY</p><h2>Evidence before estimates</h2></div></div>
          <div className="guard-list">
            <div><span>Hidden estimate</span><strong>n &lt; 30</strong></div>
            <div><span>Provisional</span><strong>n = 30–99</strong></div>
            <div><span>Established</span><strong>n ≥ 100</strong></div>
            <div><span>Confidence interval</span><strong>95%</strong></div>
          </div>
        </article>
        <article className="panel compact-panel">
          <div className="panel-heading"><div><p className="section-kicker">METHODOLOGY</p><h2>Point-in-time controls</h2></div></div>
          <div className="guard-list">
            <div><span>Entry basis</span><strong>Next session open</strong></div>
            <div><span>MAE / MFE</span><strong>Intraperiod low / high</strong></div>
            <div><span>Outcome mutation</span><strong className="negative">BLOCKED</strong></div>
            <div><span>Version</span><strong>{research.methodologyVersion}</strong></div>
          </div>
        </article>
      </section>
    </div>
  );
}

function Inspector({ row, onClose, demo }: { row: QuantRow; onClose: () => void; demo: boolean }) {
  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="inspector" role="dialog" aria-modal="true" aria-label={`${row.symbol} score inspector`} onMouseDown={(event) => event.stopPropagation()}>
        <div className="drawer-handle" />
        <div className="inspector-heading">
          <div><p className="section-kicker">SCORE INSPECTOR {demo ? "· DEMO" : ""}</p><h2>{row.symbol}</h2><p>{row.name} · {row.sector}</p></div>
          <button type="button" className="close-button" onClick={onClose} aria-label="Close inspector">×</button>
        </div>
        <div className="inspector-score">
          <div><span>QUANT SCORE</span><ScoreBadge value={row.quantScore} large /></div>
          <div><span>UNIVERSE RANK</span><strong>#{row.rank}</strong></div>
          <div><span>LAST CLOSE</span><strong>RM {formatPrice(row.close)}</strong></div>
        </div>
        <div className="score-bridge">
          <div className="bridge-heading"><strong>Weighted score bridge</strong><span>v1 fixed weights</span></div>
          {scoreFields.map(([field, label, weight]) => {
            const value = Number(row[field]);
            return <div className="bridge-row" key={String(field)}><span>{label}<small>{weight}</small></span><MiniBar value={value} /><strong>{value.toFixed(1)}</strong></div>;
          })}
        </div>
        <div className="strategy-strip">
          <div><span>Trending</span><strong>{row.trendingScore.toFixed(1)}</strong></div>
          <div><span>Momentum</span><strong>{row.momentumStrategyScore.toFixed(1)}</strong></div>
          <div><span>M.E.T.A.</span><strong>{row.metaScore.toFixed(1)}</strong></div>
        </div>
        <div className="diagnostic-grid">
          <div><span>20D return</span><strong>{formatPercent(row.return20)}</strong></div>
          <div><span>RS20 vs KLCI</span><strong>{formatPercent(row.rs20)}</strong></div>
          <div><span>ATR14</span><strong>{row.atr14 === null ? "—" : formatPrice(row.atr14)}</strong></div>
          <div><span>ATR %</span><strong>{formatPercent(row.atrPct)}</strong></div>
          <div><span>20D traded value</span><strong>RM {compactMoney(row.averageTradedValue20)}</strong></div>
          <div><span>52W high distance</span><strong>{formatPercent(row.distance52WeekHigh)}</strong></div>
        </div>
        <div className="quality-block">
          <strong>Data confidence</strong>
          <p>{row.historyDays} trading bars · Sector RS {row.sectorRsAvailable ? "available" : "unavailable"}</p>
          <div className="flag-row">{row.qualityFlags.length ? row.qualityFlags.map((flag) => <span key={flag}>{flag.replaceAll("_", " ")}</span>) : <span className="clear-flag">NO QUALITY FLAGS</span>}</div>
        </div>
        <p className="inspector-footnote">Quant Score is a ranking signal, not a buy instruction. Expected edge stays hidden until Phase 2 reaches its stated sample threshold; position sizing remains a later phase.</p>
      </aside>
    </div>
  );
}

export function QuantTerminal({
  initialSnapshot,
  initialResearch,
}: {
  initialSnapshot: DashboardSnapshot;
  initialResearch: ResearchSnapshot;
}) {
  const [tab, setTab] = useState<Tab>("today");
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [selected, setSelected] = useState<QuantRow | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [loading, setLoading] = useState(false);
  const [runState, setRunState] = useState<"idle" | "queuing" | "queued">("idle");
  const [runNotice, setRunNotice] = useState<{ tone: "good" | "error"; message: string } | null>(null);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState({ search: "", sector: "", minimumScore: 0, sort: "score" as Sort });

  useEffect(() => {
    const preferred = localStorage.getItem("bmk-theme") === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = preferred;
    const timer = window.setTimeout(() => setTheme(preferred), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (initialSnapshot.mode !== "LIVE") return;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      const params = new URLSearchParams({
        search: query.search,
        sector: query.sector,
        minimumScore: String(query.minimumScore),
        sort: query.sort,
        direction: query.sort === "symbol" ? "asc" : "desc",
        page: String(page),
        pageSize: "100",
      });
      try {
        const response = await fetch(`/api/ranking?${params}`, { signal: controller.signal });
        if (response.ok) setSnapshot((await response.json()) as DashboardSnapshot);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 220);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [initialSnapshot.mode, page, query]);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("bmk-theme", next);
  };

  const startScreening = async () => {
    if (runState === "queuing") return;

    let runKey = window.localStorage.getItem(RUN_KEY_STORAGE)?.trim() ?? "";
    if (!runKey) {
      runKey = window.prompt(
        "Enter the Manual Run Key saved in your Cloudflare Worker. It stays only on this device.",
      )?.trim() ?? "";
      if (!runKey) {
        setRunNotice({ tone: "error", message: "Screening cancelled: Manual Run Key is required." });
        return;
      }
      window.localStorage.setItem(RUN_KEY_STORAGE, runKey);
    }

    setRunState("queuing");
    setRunNotice({ tone: "good", message: "Requesting a full Bursa screening and verified publication…" });
    try {
      const response = await fetch(RUN_GATEWAY_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Run-Key": runKey,
        },
        body: "{}",
      });
      const result = (await response.json()) as {
        error?: string;
        message?: string;
        retryAfterSeconds?: number;
      };
      if (!response.ok) {
        if (response.status === 401) {
          window.localStorage.removeItem(RUN_KEY_STORAGE);
        }
        setRunState("idle");
        setRunNotice({
          tone: "error",
          message:
            response.status === 401
              ? "Manual Run Key rejected. Tap Run and enter it again."
              : response.status === 429
                ? `A screening was recently requested. Try again in ${result.retryAfterSeconds ?? 300} seconds.`
                : result.message ?? "Screening could not be started.",
        });
        return;
      }
      setRunState("queued");
      setRunNotice({
        tone: "good",
        message:
          result.message ??
          "Full Bursa screening queued; verified scores will update the private terminal.",
      });
      window.setTimeout(() => setRunState("idle"), 8000);
    } catch {
      setRunState("idle");
      setRunNotice({ tone: "error", message: "The screening service is unavailable." });
    }
  };

  return (
    <div className="terminal-shell">
      <Header snapshot={snapshot} theme={theme} onTheme={toggleTheme} onRun={startScreening} runState={runState} />
      {runNotice && (
        <div className={`run-notice ${runNotice.tone}`} role="status" aria-live="polite">
          <span aria-hidden="true">{runNotice.tone === "good" ? "●" : "!"}</span>
          <strong>{runNotice.message}</strong>
          <button type="button" onClick={() => setRunNotice(null)} aria-label="Dismiss run status">×</button>
        </div>
      )}
      <main className="terminal-main">
        {tab === "today" && <TodayView snapshot={snapshot} onInspect={setSelected} />}
        {tab === "ranking" && <RankingView snapshot={snapshot} onInspect={setSelected} query={query} setQuery={setQuery} page={page} setPage={setPage} loading={loading} />}
        {tab === "regime" && <RegimeView snapshot={snapshot} />}
        {tab === "research" && <ResearchView research={initialResearch} />}
        {tab === "health" && <HealthView snapshot={snapshot} />}
      </main>
      <nav className="bottom-nav" aria-label="Primary navigation">
        <button type="button" className={tab === "today" ? "active" : ""} onClick={() => setTab("today")}><span aria-hidden="true">◫</span><strong>Today</strong></button>
        <button type="button" className={tab === "ranking" ? "active" : ""} onClick={() => setTab("ranking")}><span aria-hidden="true">≡</span><strong>Ranking</strong></button>
        <button type="button" className={tab === "regime" ? "active" : ""} onClick={() => setTab("regime")}><span aria-hidden="true">◉</span><strong>Regime</strong></button>
        <button type="button" className={tab === "research" ? "active" : ""} onClick={() => setTab("research")}><span aria-hidden="true">∿</span><strong>Research</strong></button>
        <button type="button" className={tab === "health" ? "active" : ""} onClick={() => setTab("health")}><span aria-hidden="true">◇</span><strong>Health</strong></button>
      </nav>
      {selected && <Inspector row={selected} onClose={() => setSelected(null)} demo={snapshot.mode !== "LIVE"} />}
    </div>
  );
}
