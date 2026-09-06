# AGENTS.md

## Repository layout

The only project is `my-qa-dashboard/` — a client-side Game QA Analytics Dashboard (React 19 + TypeScript + Vite 8). All commands below run from `my-qa-dashboard/`.

## Commands

```sh
npm run dev      # Vite dev server
npm run build    # tsc -b && vite build
npm run lint     # oxlint (config: .oxlintrc.json; not ESLint)
npm run preview  # preview built app
```

There is no test suite.

Regenerating sample data (per-run CSV/JSON under `public/sample_data/run-XXX/` plus the mock search index `public/mock_data/runs.json`) uses Python via uv — never pip or plain python. The script uses PEP 723 inline dependencies:

```sh
uv run scripts/generate_sample_data.py
```

## Architecture

Everything runs in the browser; there is no backend.

- **DuckDB-WASM is the data layer.** `src/hooks/useDuckDB.ts` owns the entire DB lifecycle: it lazily instantiates DuckDB-WASM (bundle fetched from jsDelivr via a Blob worker) and registers fetched/uploaded data files into DuckDB's virtual filesystem via `registerFileBuffer` (`loadRemoteFile` for URLs, `loadLocalCsvFile` for local uploads).
- Components query registered files directly with SQL via `read_csv_auto('...')` / `read_json_auto('...')` chosen by file extension (see `fromClause` in `App.tsx`). No Parquet anywhere in this project — FPS/memory/log data are all handled in the raw-ish form UE itself outputs (CSV / JSON / plain text), which is simpler than adding a columnar conversion step.
- **Search-first flow.** `App.tsx` starts on `SearchPage` (test run search). `src/services/` abstracts the search backend: `SearchService.ts` defines `SearchFilter` / `TestRunSummary` / the `SearchService` interface; `MockSearchService` fetches `public/mock_data/runs.json` and filters client-side; `ApiSearchService` is an unimplemented stub for the future S3/Athena backend. `services/index.ts` picks the implementation from `VITE_USE_MOCK` (mock unless set to `'false'`).
- Opening a run hands its `TestRunSummary` (data URLs) to the dashboard: `App.tsx` registers the run's fps/memory files via `loadRemoteFile`, queries them with `executeQuery<T>()`, holds results in state, and passes them down. `LogTable` instead receives `executeQuery` as a prop and runs its own filtered queries on the `ue_logs` table.
- Charts use ECharts via `echarts-for-react` (`FpsChart`, `MemoryChart`); icons are `lucide-react`; styling is Tailwind CSS v4 (via `@tailwindcss/vite` plugin — no tailwind.config file).
- Shared TypeScript interfaces (`FpsMetric`, `MemoryMetric`, `LogEntry`, etc.) live in `src/types/index.ts` and must match the CSV/JSON schemas produced by `scripts/generate_sample_data.py`; `TestRunSummary` in `src/services/SearchService.ts` must match the `runs.json` shape from the same script.
- UE log parsing lives in a single place, `src/utils/ueLogParser.ts`, used by the browser (`LogTable`'s "open local UE log" flow, parsed client-side and loaded into DuckDB via `loadRowsAsTable`). Don't reimplement this parser elsewhere — keep it framework-agnostic (no DOM/browser-only APIs).

## Conventions

- `@duckdb/duckdb-wasm` is excluded from Vite `optimizeDeps` (see `vite.config.ts`) — keep it that way.
- `executeQuery` converts Arrow `BigInt` cell values to `number`; results are plain JS objects typed via the generic parameter.
- User-supplied strings interpolated into SQL must be escaped (see `escapeSql` in `LogTable.tsx` — single quotes doubled).
- Fetch public assets with the `import.meta.env.BASE_URL` prefix, not absolute `/` paths.
- UI is dark-themed (slate-950 background, cyan accents); some user-facing labels are in Japanese.
