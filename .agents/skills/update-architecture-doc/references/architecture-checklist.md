# Game QA Dashboard — アーキテクチャ検証チェックリスト

本チェックリストは、`docs/architecture.md` を更新または監査する際に、実装コードとドキュメントの整合性を担保するためのリファレンスです。

---

## 1. フロントエンド (`my-qa-dashboard/`)

### 1.1 参照先ソースコード
- 画面・コンポーネント: `src/components/*.tsx`
- アプリケーションコア & ルーティング: `src/App.tsx`, `src/router/*.ts`, `src/utils/routeHelpers.ts`
- データ層 (DuckDB-WASM): `src/hooks/useDuckDB.ts`, `src/utils/diffQueries.ts`, `src/utils/logQueryHelpers.ts`
- タイムライン同期・メディア: `src/utils/timeHelpers.ts`, `src/utils/mediaHelpers.ts`
- バックエンド連携サービス: `src/services/*.ts`
- ビルド・最適化設定: `vite.config.ts`, `package.json`

### 1.2 検証項目
- [ ] **画面コンポーネント一覧**:
  - `SearchPage`: 複合条件検索（日付、バージョン、PF、テスト名、ステータス）、2件選択比較機能、ソート。
  - `ComparePage`: 2つのRun（Run A vs Run B）の横並び比較、`FpsDiffChart`（FPS/FrameTime差分）、`MemoryDiffChart`（カテゴリ別差分）、アーティファクト比較。
  - `TrendsPage`: 複数Runの時系列品質トレンド、期間絞り込み（7d/14d/30d/90d/All）、合格率・平均FPS・ピークメモリ推移KPI。
  - `FpsChart` / `MemoryChart`: EChartsによるミリ秒時系列描画、仮想ダウンサンプリング、タイムライン連動。
  - `LogTable`: Unreal Engineログ全文検索・レベルフィルタ、仮想スクロール、ローカルログファイル読み込み（`ueLogParser.ts`）。
  - `MediaViewer`: 動画シーク再生（HTTP Range）、FPSチャートとのタイムライン双方向同期、スクリーンショットギャラリー（拡大/縮小/回転/パン/リセット）、一覧/グリッド表示。
  - `ArtifactsPanel`: 全種別アーティファクト一覧・カテゴリフィルタ、ブラウザ内プレビュー、単一ダウンロード、`client-zip` によるブラウザ内一括ZIP圧縮ダウンロード。
  - `AccessKeyModal`: CLI用個人APIキーの発行・一覧・失効管理モーダル。
- [ ] **クライアントルーティング & ディープリンク**:
  - HTML5 History API（`pushState` / `popstate`）による `/`, `/runs/:runId`, `/compare?a=...&b=...`, `/trends` の完全サポート。
  - タイムライン位置（`t`）、選択メディア（`media`）、ログ行（`log`）、検索フィルタ、タブ状態のURLクエリパラメータ同期と1クリック共有。
- [ ] **データエンジン (DuckDB-WASM)**:
  - `public/duckdb-wasm/` からのセルフホスト配信（同一オリジン、Blob Worker）。
  - `read_csv_auto` / `read_json_auto` の自動拡張子判別（No Parquet 原則）。
  - 並行実行時のファイル名競合防止（セッション一意識別子）および集計完了後の一時ファイル自動破棄（`dropFile`）。
- [ ] **パフォーマンス & 最適化**:
  - `React.lazy` と `Suspense` によるヘビーページ（Compare, Trends, Charts, Modal）のコード分割。
  - Rollup 手動チャンク分割（`vendor-duckdb`, `vendor-echarts`, `vendor-virtual`）。

---

## 2. バックエンド API (`onprem/backend/`)

### 2.1 参照先ソースコード
- メインルーティング & アプリケーション: `main.py`
- データベースアクセス & スキーマ: `db.py`
- クリーンアップ & ストレージ保護: `cleanup.py`
- コンテナ設定: `Dockerfile`, `requirements.txt`

### 2.2 検証項目
- [ ] **API エンドポイント定義**:
  - `GET /api/health`: サービスヘルスチェック
  - `GET /api/storage/status`: ディスク空き容量、使用量、クォータ閾値取得
  - `POST /api/storage/cleanup`: 期限切れ動画・ダンプの手動クリーンアップ実行
  - `GET /api/keys`, `POST /api/keys`, `DELETE /api/keys/{key_id}`: 個人用 API キー管理
  - `PUT /api/upload/runs/{run_id}/{file_name}` (および POST): 大容量ファイル非同期ストリーミング保存
  - `POST /api/search` & `GET /api/search`: 複合条件検索（POST JSON および GET クエリパラメータ）
  - `GET /api/runs/{run_id}`: 単一 Run サマリ取得
- [ ] **ストレージ自動保護 & 改ざん防止**:
  - ディスク空き容量クォータ（空き 10% 未満または 1GB 未満で `HTTP 507 Insufficient Storage`）。
  - 確定済み Run への無許可上書き防止（`manifest.json` 存在時は `HTTP 409 Conflict`、`?overwrite=true` で許可）。
  - `manifest.json` 保存検知時の SQLite 自動インデックス。
- [ ] **定期クリーンアップ仕様 (`cleanup.py`)**:
  - 指定日数超過の Run から大容量動画（`.mp4`）およびダンプ（`.dmp`）を物理削除。
  - CSV、ログ、`manifest.json`、SQLite レコードは恒久保護。
  - SQLite `test_runs.video_url` の NULL 更新。

---

## 3. 内部リバースプロキシ & 認証 (`onprem/nginx/`, `onprem/docker-compose.yml`)

### 3.1 参照先ソースコード
- Nginx 設定: `nginx.conf`
- Compose 定義: `docker-compose.yml`
- 環境変数定義: `.env.example`

### 3.2 検証項目
- [ ] **パスごとのルーティング仕様**:
  - `/`: SPA 静的ファイル配信（`try_files $uri $uri/ /index.html`）、Google OAuth2 保護
  - `/duckdb-wasm/`: 長期イミュータブルキャッシュ（`Cache-Control: public, max-age=31536000, immutable`）
  - `/data/runs/`: ゼロコピー直配信（`sendfile on`, `aio threads`）、HTTP Range 部分取得対応、CORS ヘッダー
  - `/api/upload/`: CLI アップロード用ダイレクトプロキシ（OAuth2 バイパス、バッファリング無効、無制限ボディサイズ、3600s タイムアウト）
  - `/api/`: 一般 API プロキシ（Google OAuth2 保護、`X-Auth-Request-Email` 転送）
  - `/oauth2/`: OAuth2-Proxy 連携エンドポイント
- [ ] **Docker サービス & ボリューム構成**:
  - サービス: `backend`, `oauth2-proxy`, `nginx`
  - ボリューム: `qa_db` (高速ローカルSSDマウント), `qa_data` (大容量ストレージ / NASマウント)

---

## 4. アップロード CLI (`cli/qa_upload.py`)

### 4.1 参照先ソースコード
- スクリプト本体: `qa_upload.py`
- 単体テスト: `test_qa_upload.py`
- 説明資料: `cli/README.md`

### 4.2 検証項目
- [ ] **サブコマンド**:
  - `upload`: テスト結果成果物の自動検出・送信
  - `login`: Google OAuth 2.0 PKCE 認証（ブラウザ自動起動、ローカルコールバック受信、`~/.config/game-qa/token.json` キャッシュ保存）
- [ ] **デュアルアップロード先**:
  - オンプレミス HTTP ストリーミング（`--server-url`, `--api-key`）
  - AWS S3 直接アップロード（`--s3-bucket`, Google PKCE + AWS STS `AssumeRoleWithWebIdentity`）
- [ ] **動画自動トランスコード**:
  - `ffmpeg` による Web 向け H.264 / AAC / `faststart` MP4 の自動生成（`--skip-transcode`, `--force-transcode`）。
- [ ] **メタデータ・成果物自動分類 (Manifest v2.0)**:
  - 9 種別（fps, memory, log, video, screenshot, crashdump, trace, report, other）の自動分類。
  - `--duration`, `--device-model`, `--triggered-by`, `--overwrite` フラグ。

---

## 5. データベース設計 (`onprem/backend/db.py`)

### 5.1 検証項目
- [ ] **SQLite WAL モード設定**:
  - `PRAGMA journal_mode = WAL;`, `PRAGMA synchronous = NORMAL;`, `PRAGMA foreign_keys = ON;`
- [ ] **テーブル定義**:
  - `test_runs`: `run_id`, `executed_at`, `game_version`, `platform`, `test_name`, `status`, `avg_fps`, `min_fps`, `peak_memory_mb`, `duration_seconds`, `device_model`, `triggered_by`, `total_size_bytes`, `artifacts_json`, `fps_data_url`, `memory_data_url`, `logs_data_url`, `video_url`, `created_at`, `updated_at`
  - `api_keys`: `key_id`, `key_hash`, `name`, `email`, `prefix`, `created_at`, `expires_at`
- [ ] **インデックス定義**:
  - `idx_runs_executed_at`, `idx_runs_platform_date`, `idx_runs_status_date`, `idx_runs_version_date`, `idx_runs_test_name`, `idx_keys_hash`, `idx_keys_email`

---

## 6. 旧 AWS クラウドインフラ (`infra/`) の廃止状況

### 6.1 参照先ソースコード
- `infra/README.md`
- `infra/lib/main-stack.ts`

### 6.2 検証項目
- [ ] DynamoDB および S3 / CloudFront 用の旧 AWS CDK スタックは**廃止（Deprecated / Retired）**として明記されていること。
- [ ] 現在の本番運用環境ではオンプレミス Docker Compose + SQLite WAL が唯一の主構成であり、AWS 側の残存リソースに対する teardown 手順が示されていること。
