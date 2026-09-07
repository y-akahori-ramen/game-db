# Game QA Analytics Dashboard — オンプレミス本番運用ガイド

本ドキュメントは、社内オンプレミス環境における Game QA Analytics Dashboard（Docker Compose: Nginx + OAuth2-Proxy + FastAPI + SQLite WAL）の本番デプロイ、永続化ストレージ設定、バックアップ、定期保守、および障害復旧に関する運用手順書です。

---

## 1. 構成概要

```text
[クライアント (ブラウザ / CLI)]
        │ HTTPS:443
        ▼
[社内 DMZ リバースプロキシ] (HTTPS 終端 / SSL 証明書管理)
        │ HTTP:8080 (X-Forwarded-Proto: https, Host ヘッダー転送)
        ▼
[オンプレミス Docker Compose 環境]
 ├── game-qa-nginx (Port 80)
 │     ├── /                  : React 19 SPA 静的アセット (OAuth2 認証保護)
 │     ├── /duckdb-wasm/      : セルフホスト DuckDB-WASM バイナリ (長期キャッシュ)
 │     ├── /data/runs/*       : テスト成果物・大容量動画ゼロコピー配信 (sendfile / Range)
 │     ├── /api/health        : ヘルスチェック (DMZ 監視用・認証バイパス)
 │     ├── /api/upload/*      : CLI アップロード (Bearer API キー認証)
 │     └── /api/*             : Web 検索 / API キー管理 API (OAuth2 認証保護)
 ├── game-qa-oauth2-proxy (Port 4180)
 │     └── Google OAuth 2.0 (OIDC) ログイン認証・セッション Cookie 発行
 └── game-qa-backend (Port 8000)
       ├── FastAPI API サーバー
       ├── SQLite データベース (`qa.db` WAL モード: インデックス・API キー)
       └── 成果物非同期ストリーミング保存 (`aiofiles`) & クリーンアップ
```

---

## 2. 前提要件

- **OS**: Linux (Ubuntu 22.04 LTS / RHEL 8, 9 / Debian 11, 12 等)
- **コンテナ環境**: Docker Engine >= 24.0, Docker Compose Plugin >= 2.20
- **ネットワーク要件**:
  - DMZ リバースプロキシから本ホストのポート `8080` (HTTP) へのインバウンド通信許可
  - 本ホストから `accounts.google.com` / `oauth2.googleapis.com` (HTTPS:443) へのアウトバウンド通信許可（社内プロキシ経由可）
- **Google Cloud Console 設定**:
  - OAuth 同意画面の作成（社内組織ドメインに制限）
  - OAuth 2.0 クライアント ID の作成（種類: Web アプリケーション）
  - 承認済みのリダイレクト URI: `https://<公開ドメイン>/oauth2/callback`

---

## 3. 初回デプロイ手順

### ステップ 1: リポジトリの配置と環境設定

```bash
git clone <リポジトリURL> game-db
cd game-db/onprem

# 設定ファイルの作成
cp .env.example .env
vi .env
```

`.env` にて最低限以下の項目を設定します：

```bash
# 1. アプリケーション公開 URL
APP_URL=https://qa-dashboard.internal.example.com
HOST_PORT=8080

# 2. Google OAuth 認証情報
GOOGLE_CLIENT_ID=xxxxxxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxxxxxxxxx
OAUTH2_PROXY_COOKIE_SECRET=$(openssl rand -base64 32 | tr -- '+/' '-_')
GOOGLE_ALLOWED_DOMAINS=example.com

# 3. 永続化ストレージパス (ホスト側の絶対パス)
HOST_STORAGE_DATA_PATH=/mnt/storage/game-qa/runs
HOST_STORAGE_DB_PATH=/var/lib/game-qa/db
```

### ステップ 2: デプロイスクリプトの実行

同梱のデプロイスクリプト [`deploy.sh`](file:///Volumes/DataDrive/programs/game-db/onprem/deploy.sh) を実行します。
前提ツールの有無、環境変数、永続ストレージの書き込み権限、フロントエンド SPA ビルドを自動検査し、サービスを起動・ヘルスチェックします。

```bash
./deploy.sh
```

---

## 4. 永続化ストレージの運用設計

### ストレージ分離の原則

| ストレージ領域 | コンテナ内パス | 推奨ホスト配置 | 理由 |
| :--- | :--- | :--- | :--- |
| **SQLite DB** (`HOST_STORAGE_DB_PATH`) | `/data/db` | **ホストの高速ローカル SSD** | SQLite WAL モードは共有メモリ (`-shm`) とファイルロックを多用するため、NFS などのネットワークファイルシステム上ではロック障害が発生します。必ずローカル SSD に配置してください。 |
| **成果物ストレージ** (`HOST_STORAGE_DATA_PATH`) | `/data/runs` | **大容量 HDD / RAID / NAS マウント (NFS/SMB)** | 数十GB〜TB単位の動画やダンプ、ログが蓄積されるため、容量拡張可能な大容量ストレージを割り当てます。 |

---

## 5. 日常の運用・保守コマンド

### 5.1 サービスの起動・停止・ログ確認

```bash
# 状態確認
docker compose ps

# リアルタイムログ監視
docker compose logs -f

# サービス再起動
docker compose restart

# 停止
docker compose down
```

### 5.2 データベースの安全なオンラインバックアップ

SQLite WAL データベースを稼働中にロックせずアトミックにバックアップします。内部で `PRAGMA integrity_check` を実施し、正常性を確認した上で gzip 圧縮して保存します。

```bash
# 手動バックアップ実行 (デフォルト: ./scripts/../backups/ に保存、14日経過分を自動パージ)
./scripts/backup_db.sh

# 出力先や保持日数を指定する場合
./scripts/backup_db.sh --output-dir /var/backups/game-qa --keep-days 30
```

#### 推奨 Cron 設定例（毎日深夜 02:00 に自動実行）:
```cron
0 2 * * * cd /path/to/game-db/onprem && ./scripts/backup_db.sh >> /var/log/game-qa-backup.log 2>&1
```

### 5.3 期限切れアーティファクトの自動パージ

指定保持期間（`.env` の `RETENTION_DAYS`、デフォルト 30 日）を超過した Run から、大容量動画（`.mp4`）やダンプ（`.dmp`）を物理削除します。CSV メトリクス、ログ、`manifest.json`、および SQLite インデックスレコードは恒久保持されます。

```bash
# 手動実行 (ドライラン: 削除対象の確認のみ)
./scripts/run_cleanup.sh --dry-run

# 実際の削除実行
./scripts/run_cleanup.sh
```

#### 推奨 Cron 設定例（毎日深夜 03:00 に自動実行）:
```cron
0 3 * * * cd /path/to/game-db/onprem && ./scripts/run_cleanup.sh >> /var/log/game-qa-cleanup.log 2>&1
```

---

## 6. 障害復旧（Disaster Recovery）

### 6.1 データベースのリストア手順

バックアップファイル（`.db.gz`）から SQLite データベースを復元する場合の手順です。

```bash
# 1. バックエンドサービスを一時停止
docker compose stop backend

# 2. 既存の DB ファイルを退避
DB_DIR="${HOST_STORAGE_DB_PATH:-$(docker volume inspect onprem_qa_db --format '{{ .Mountpoint }}')}"
mv "${DB_DIR}/qa.db" "${DB_DIR}/qa.db.corrupt.$(date +%s)"
rm -f "${DB_DIR}/qa.db-wal" "${DB_DIR}/qa.db-shm"

# 3. バックアップアーカイブを展開して配置
gunzip -c /path/to/qa_backup_YYYYMMDD_HHMMSS.db.gz > "${DB_DIR}/qa.db"
chmod 644 "${DB_DIR}/qa.db"

# 4. バックエンドサービスを再開
docker compose start backend

# 5. ヘルスチェックとデータ整合性の確認
curl -s http://localhost:8080/api/health
```

---

## 7. トラブルシューティング

| 症状 | 主な原因 | 対処方法 |
| :--- | :--- | :--- |
| **Web ログイン時に `Redirect URI mismatch`** | Google Cloud Console の承認済みリダイレクト URI の不一致 | Console の URI に `${APP_URL}/oauth2/callback` が正確に登録されているか確認。 |
| **ログイン後にリダイレクトループが発生する** | DMZ プロキシの `X-Forwarded-Proto` 欠落 | DMZ プロキシで `proxy_set_header X-Forwarded-Proto https;` が転送されているか確認（[`docs/dmz-reverse-proxy-guide.md`](docs/dmz-reverse-proxy-guide.md) 参照）。 |
| **アップロード時に `HTTP 507 Insufficient Storage`** | ストレージ空き容量が 10% 未満または 1GB 未満 | `df -h ${HOST_STORAGE_DATA_PATH}` で空き容量を確認し、不要なファイルを削除するか `./scripts/run_cleanup.sh` を実行。 |
| **アップロード時に `HTTP 409 Conflict`** | 同一 Run ID の `manifest.json` が既に確定済み | テスト結果の意図的な再実行・上書きの場合は、CLI コマンドに `--overwrite` フラグを付与。 |
| **DMZ 死活監視が Unhealthy になる** | ヘルスチェック URL が OAuth2 でブロックされている | 監視パスを `http://host:8080/api/health` に設定。Nginx で認証バイパス設定済みです。 |
