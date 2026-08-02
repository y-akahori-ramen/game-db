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

Regenerating sample data (Parquet files in `public/sample_data/`) uses Python via uv — never pip or plain python. The script uses PEP 723 inline dependencies:

```sh
uv run scripts/generate_sample_data.py
```

## Architecture

Everything runs in the browser; there is no backend.

- **DuckDB-WASM is the data layer.** `src/hooks/useDuckDB.ts` owns the entire DB lifecycle: it lazily instantiates DuckDB-WASM (bundle fetched from jsDelivr via a Blob worker), fetches the Parquet files from `public/sample_data/`, and registers them into DuckDB's virtual filesystem via `registerFileBuffer`.
- Components query Parquet files directly with SQL, referencing registered file names as table names, e.g. `SELECT ... FROM 'fps_metrics.parquet'`.
- Data flow: `App.tsx` calls `loadParquetFiles()` + `executeQuery<T>()` from `useDuckDB`, holds results in state, and passes them down. `LogTable` instead receives `executeQuery` as a prop and runs its own filtered queries on `'logs.parquet'`.
- Charts use ECharts via `echarts-for-react` (`FpsChart`, `MemoryChart`); icons are `lucide-react`; styling is Tailwind CSS v4 (via `@tailwindcss/vite` plugin — no tailwind.config file).
- Shared TypeScript interfaces (`FpsMetric`, `MemoryMetric`, `LogEntry`, etc.) live in `src/types/index.ts` and must match the Parquet schemas produced by `scripts/generate_sample_data.py`.

## Conventions

- `@duckdb/duckdb-wasm` is excluded from Vite `optimizeDeps` (see `vite.config.ts`) — keep it that way.
- `executeQuery` converts Arrow `BigInt` cell values to `number`; results are plain JS objects typed via the generic parameter.
- User-supplied strings interpolated into SQL must be escaped (see `escapeSql` in `LogTable.tsx` — single quotes doubled).
- Fetch public assets with the `import.meta.env.BASE_URL` prefix, not absolute `/` paths.
- UI is dark-themed (slate-950 background, cyan accents); some user-facing labels are in Japanese.
