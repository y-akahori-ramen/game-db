# AGENTS.md

## Repository layout

- `my-qa-dashboard/` — client-side Game QA Analytics Dashboard (React 19 + TypeScript + Vite 8 + DuckDB-WASM + Tailwind CSS v4).
- `onprem/` — on-premises infrastructure & backend (Docker Compose: Nginx + OAuth2-Proxy + FastAPI + SQLite WAL).
- `cli/` — QA test run upload CLI tool (`qa_upload.py`, supports HTTP streaming & AWS S3 dual-mode).
- `scripts/` — pipeline test (`test_local_pipeline.py`) & mock data generator (`generate_sample_data.py`).
- `docs/` — detailed architecture design (`docs/architecture.md`) & DMZ reverse proxy guide.

## Commands

### Frontend (`my-qa-dashboard/`)
```sh
npm run dev      # Vite dev server
npm run build    # tsc -b && vite build
npm run lint     # oxlint (config: .oxlintrc.json; not ESLint)
npm run test     # node --experimental-strip-types unit tests
npm run preview  # preview built app
```

Regenerating sample data uses Python via uv (or python3) with PEP 723 inline dependencies:
```sh
uv run scripts/generate_sample_data.py
```

### Backend & CLI Tests (from repository root)
```sh
# CLI unit tests
python3 -m unittest discover -s cli -v

# Backend & SQLite WAL tests
python3 -m unittest discover -s onprem/backend -v

# Stage 2 Local pipeline end-to-end test (CLI -> FastAPI -> SQLite -> Search)
uv run scripts/test_local_pipeline.py
```

## Architecture

- **DuckDB-WASM is the client-side data layer.** `src/hooks/useDuckDB.ts` owns the entire DB lifecycle: it lazily instantiates DuckDB-WASM (self-hosted bundles served from `public/duckdb-wasm/` via a Blob worker) and registers fetched/uploaded data files into DuckDB's virtual filesystem via `registerFileBuffer` (`loadRemoteFile` for URLs, `loadLocalCsvFile` for local uploads).
- Components query registered files directly with SQL via `read_csv_auto('...')` / `read_json_auto('...')` chosen by file extension (see `fromClause` in `App.tsx`). No Parquet anywhere in this project — FPS/memory/log data are all handled in the raw-ish form UE itself outputs (CSV / JSON / plain text), which is simpler than adding a columnar conversion step.
- **Search-first flow.** `App.tsx` starts on `SearchPage` (test run search). `src/services/` abstracts the search backend: `SearchService.ts` defines `SearchFilter` / `TestRunSummary` / the `SearchService` interface; `MockSearchService` fetches `public/mock_data/runs.json` and filters client-side; `ApiSearchService` calls the deployed `/api/search` endpoint (provided by `onprem/backend/main.py` querying SQLite WAL). `services/index.ts` picks the implementation from `VITE_USE_MOCK` (mock unless set to `'false'`).
- Opening a run hands its `TestRunSummary` (data URLs) to the dashboard: `App.tsx` registers the run's fps/memory files via `loadRemoteFile`, queries them with `executeQuery<T>()`, holds results in state, and passes them down. `LogTable` instead receives `executeQuery` as a prop and runs its own filtered queries on the `ue_logs` table.
- Charts use ECharts via `echarts-for-react` (`FpsChart`, `MemoryChart`, `FpsDiffChart`, `MemoryDiffChart`); icons are `lucide-react`; styling is Tailwind CSS v4 (via `@tailwindcss/vite` plugin — no tailwind.config file).
- Shared TypeScript interfaces (`FpsMetric`, `MemoryMetric`, `LogEntry`, etc.) live in `src/types/index.ts` and must match the CSV/JSON schemas produced by `scripts/generate_sample_data.py`; `TestRunSummary` in `src/services/SearchService.ts` must match the `runs.json` shape from the same script.
- UE log parsing lives in a single place, `src/utils/ueLogParser.ts`, used by the browser (`LogTable`'s "open local UE log" flow, parsed client-side and loaded into DuckDB via `loadRowsAsTable`). Don't reimplement this parser elsewhere — keep it framework-agnostic (no DOM/browser-only APIs).
- **On-premises deployment (`onprem/`):** Docker Compose runs 3 services (Nginx, OAuth2-Proxy, FastAPI backend). Nginx serves static SPA assets and streams large files from `/data/runs/` directly with `sendfile` and HTTP Range support. API requests are protected by OAuth2-Proxy or CLI API keys. SQLite operates in WAL mode (`/data/db/qa.db`).

## Conventions

- `@duckdb/duckdb-wasm` is excluded from Vite `optimizeDeps` (see `vite.config.ts`) — keep it that way.
- `executeQuery` converts Arrow `BigInt` cell values to `number`; results are plain JS objects typed via the generic parameter.
- User-supplied strings interpolated into SQL must be escaped (see `escapeSql` in `LogTable.tsx` — single quotes doubled).
- Fetch public assets with the `import.meta.env.BASE_URL` prefix, not absolute `/` paths.
- UI is dark-themed (slate-950 background, cyan accents); some user-facing labels are in Japanese.
- **Git commit messages must be written in Japanese.** Use conventional prefix if applicable, but keep summary and description in Japanese (e.g. `feat: ○○機能の実装`, `fix: △△の不具合を修正`).
