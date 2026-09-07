# QA Upload CLI

QA テスト実行アーティファクトのアップロード用 CLI ツールです。**社内オンプレミス運用環境への HTTP 直接ストリーミングアップロード（個人用 API キー認証・30GB 制限完全撤廃）** および **AWS S3 への直接アップロード（Google OAuth 2.0 PKCE / STS 連携）** の両モードに対応しています。

---

## Overview

- **オンプレミス HTTP アップロード（推奨・デフォルト運用）**:
  - Web 画面で発行した **個人用 API キー** (`--api-key`) を指定し、社内オンプレミスサーバー (`--server-url`) へ直接ストリーミング PUT。
  - **30GB ファイルサイズ制限は自動的に完全撤廃**。数十GB超のゲームプレイ動画やプロファイルトレースもそのままアップロード可能。
  - CI/CD パイプライン（GitHub Actions, Jenkins 等）や自動テスト機から**完全非対話**で高速に実行可能。
  - 成果物アップロード完了後、`manifest.json` の受信時にバックエンドが AWS DynamoDB 検索インデックスへ即座に自動登録。
- **AWS S3 アップロード（クラウド直接運用）**:
  - IAM アクセスキーを端末に配布せず、**Google アカウント認証**（OAuth 2.0 PKCE）と **AWS STS `AssumeRoleWithWebIdentity`** により一時クレデンシャルを取得して S3 バケット (`--bucket`) へ直接マルチパートアップロード。
  - リフレッシュトークンキャッシュ (`~/.config/game-qa/token.json`) による非対話自動更新。
  - 従来の AWS IAM プロファイル (`--profile`) もサポート。
- **任意成果物の自動検出 & 分類**:
  - ディレクトリ内のファイルを再帰的に走査し、FPS/メモリメトリクス、UE ログ、動画、スクリーンショット、クラッシュダンプ、トレース、レポートを自動分類してマニフェスト化。
- **Web 最適化動画の自動トランスコード**:
  - 大容量の動画ファイル（`capture.mp4` 等）を検出した場合、ブラウザで高速再生可能な H.264/AAC `faststart` 動画 (`*_web.mp4`) を自動生成して同時アップロード。

---

## Prerequisites

- `uv` (Python >= 3.10)
- 動画トランスコード用（任意）: `ffmpeg`
- **オンプレミスモードの場合**:
  - Web ダッシュボードで発行した個人用 API キー (`gqa_live_...`)
  - オンプレミスサーバー URL（例: `http://localhost:8080` または社内 DMZ の `https://qa-dashboard.internal.example.com`）
- **S3 モードの場合**:
  - Google Cloud OAuth 2.0 クライアント ID（デスクトップ アプリケーション種別）
  - AWS IAM OIDC ID プロバイダ (`accounts.google.com`) およびアップロード用 IAM ロール

---

## Usage

### 1. オンプレミスサーバーへのアップロード（推奨）

Web 画面（右上の「CLI キー」ボタン）で個人用 API キーを発行し、`--server-url` と `--api-key` を指定して実行します。

```sh
export QA_SERVER_URL="http://localhost:8080"
export QA_API_KEY="gqa_live_xxxxxxxxxxxxxxxxxxxxxxxx"

uv run cli/qa_upload.py upload \
  --server-url "$QA_SERVER_URL" \
  --api-key "$QA_API_KEY" \
  --run-dir ./my-qa-dashboard/public/sample_data/run-001 \
  --run-id run-001 \
  --game-version v1.2.0 \
  --platform PS5 \
  --test-name Level1_Playthrough \
  --result PASSED \
  --avg-fps 59.8
```

※ `--server-url` モードでは、S3 関連引数（`--bucket`, `--role-arn`）は不要です。また、30GB 超のファイルサイズ制限チェックは自動的にバイパスされます。

---

### 2. AWS S3 への直接アップロード（クラウド直接運用）

#### A. 初回 Google ログイン（事前ログイン）

```sh
export GOOGLE_CLIENT_ID="xxxxxx.apps.googleusercontent.com"
uv run cli/qa_upload.py login
```

ブラウザが開くので Google アカウントでログインを完了します。トークンが `~/.config/game-qa/token.json` に安全に保存されます。

#### B. S3 へのアップロード実行

```sh
export GOOGLE_CLIENT_ID="xxxxxx.apps.googleusercontent.com"
export GAME_QA_UPLOAD_ROLE_ARN="arn:aws:iam::123456789012:role/GameQaUploadRole"

uv run cli/qa_upload.py upload \
  --bucket qa-data \
  --run-dir ./local_run_folder \
  --run-id run-001 \
  --game-version v1.2.0 \
  --platform PS5 \
  --test-name Level1_Playthrough \
  --result FAILED \
  --avg-fps 54.2
```

---

### 3. 動画トランスコード (`transcode`)

大容量動画（数十GB）を Web ダッシュボードで遅延なく快適に再生するために、Web 最適化 MP4（H.264 / AAC / `faststart` 適用）へ変換します。

```sh
# 単一動画ファイルをトランスコード (例: capture.mp4 -> capture_web.mp4)
uv run cli/qa_upload.py transcode ./local_run_folder/capture.mp4

# ディレクトリ内のすべての元動画を一括トランスコード
uv run cli/qa_upload.py transcode ./local_run_folder/ --resolution 1080p --crf 23
```

※ `upload` コマンド実行時、対象ディレクトリに `*_web.mp4` が存在しない場合は**自動的にトランスコードが実行**されます（すでに存在する場合はトランスコードをスキップして即アップロードに進みます）。`--skip-transcode` で自動実行を無効化できます。

---

### 4. 認証状態の確認・管理 (`whoami`, `logout`)

Google アカウント認証を使用している場合の確認・失効コマンドです：

```sh
# 現在のログインアカウントと有効期限を確認
uv run cli/qa_upload.py whoami

# トークンキャッシュを削除してログアウト
uv run cli/qa_upload.py logout
```

---

## 成果物の自動検出・分類仕様

`--run-dir` 配下のファイルを再帰的にスキャンし、以下のルールで成果物種別（`type`）を自動判定します：

| 分類 (`type`) | 検出条件（ファイル名 / 拡張子） | Web ダッシュボードでの表示・動作 |
| :--- | :--- | :--- |
| `fps` | `fps_metrics.csv`、または名前に `fps` を含む `.csv` / `.json` | ECharts FPS/フレームタイム チャート描画 |
| `memory` | `memory_metrics.csv`、または名前に `memory` / `llm` を含む `.csv` / `.json` | LLM メモリ使用量チャート & ピーク集計表描画 |
| `log` | `ue.log`、または拡張子が `.log` / `.txt` | ログアナライザー（SQL検索・レベル別フィルタ・前後行表示） |
| `video` | `capture.mp4`, `video.mp4`、または `.mp4`, `.webm`, `.mov`, `.avi` | メディアビューア（動画再生・シーク連動） |
| `screenshot` | `.png`, `.jpg`, `.jpeg`, `.webp` | メディアビューア（画像拡大・一覧サムネイル表示） |
| `crashdump` | `.dmp`, `.mdmp` | 成果物パネル（ダウンロードリンク） |
| `trace` | `.utrace`, `.trace` (Unreal Insights トレース等) | 成果物パネル（ダウンロードリンク） |
| `report` | `.html`, `.xml` (テスト結果レポート等) | 成果物パネル（ダウンロードリンク） |
| `other` | 上記以外のすべてのファイル | 成果物パネル（ダウンロードリンク） |

---

## Options Reference

### `upload` Options

| オプション | 環境変数 | 説明 |
| :--- | :--- | :--- |
| `--server-url` | `QA_SERVER_URL` | オンプレミスサーバー URL（指定時、HTTP アップロードモードで動作） |
| `--api-key` | `QA_API_KEY` | オンプレミスアップロード用 個人 API キー（`gqa_live_...`） |
| `--bucket` | — | アップロード先 S3 バケット名（**S3 モード時のみ必須**。`--server-url` 指定時は不要） |
| `--run-dir` | — | アップロード対象成果物が格納されたディレクトリ（**必須**） |
| `--run-id` | — | テスト実行識別子（例: `run-001`）（**必須**） |
| `--game-version` | — | ゲームバージョン（**必須**） |
| `--platform` | — | 対象プラットフォーム（例: `PS5`, `Windows`）（**必須**） |
| `--test-name` | — | テスト名（**必須**） |
| `--result` | — | テスト結果（`PASSED` または `FAILED`）（**必須**） |
| `--avg-fps` | — | 平均 FPS（**必須**） |
| `--executed-at` | — | 実行時刻（UTC ISO8601、省略時は現在時刻） |
| `--allow-large-files` | — | S3 モード時に 30GiB 超のファイルを許容する（`--server-url` モードでは自動有効） |
| `--skip-transcode` | — | Web 最適化動画が存在しない場合でも自動トランスコードをスキップする |
| `--force-transcode` | — | 既存の Web 最適化動画があっても強制的に再トランスコードする |
| `--role-arn` | `GAME_QA_UPLOAD_ROLE_ARN` | Google Web Identity で Assume する IAM ロール ARN（S3 モード） |
| `--google-client-id` | `GOOGLE_CLIENT_ID` | Google OAuth 2.0 クライアント ID（S3 モード） |
| `--google-client-secret` | `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 クライアントシークレット（通常不要） |
| `--token-cache` | `GAME_QA_TOKEN_CACHE` | トークン保存先（デフォルト: `~/.config/game-qa/token.json`） |
| `--no-browser` | — | ブラウザを自動起動せず、ターミナルにログイン URL を表示する |
| `--profile` | — | 従来の AWS プロファイル（Google 認証ではなく IAM で実行する場合に使用） |
| `--endpoint-url` | `AWS_ENDPOINT_URL` | LocalStack / MinIO テスト用 S3 エンドポイント URL |

### `transcode` Options

| オプション | デフォルト | 説明 |
| :--- | :--- | :--- |
| `source` | （必須） | 入力動画ファイルパス、または動画を含むディレクトリパス |
| `-o`, `--output` | `<stem>_web.mp4` | 出力ファイルパス（単一ファイル変換時のみ） |
| `--resolution` | `1080p` | 出力解像度 (`1080p`, `720p`, `original`) |
| `--crf` | `23` | x264 の品質係数（CRF値、小さいほど高品質） |
| `--preset` | `fast` | x264 エンコードプリセット |
| `-f`, `--force` | `false` | 出力先が既に存在する場合でも強制的に上書き再エンコード |

---

## Safety & Atomic Publishing

- **オンプレミス HTTP ストリーミング PUT**:
  - メモリにバッファせず、リクエストボディをディスクへ直接ストリーミング書き込み。巨大ファイルもサーバー負荷なく保存されます。
  - 子ファイル群を先行アップロードし、最後に `manifest.json` をアップロード。`manifest.json` 受信完了時に DynamoDB へ自動インデックスされます。
- **S3 アップロードの順序保証**:
  - 子ファイル群を先にマルチパートアップロードし、最後に `manifest.json` を PUT。これにより検索結果への露出が原子的（アトミック）に保証されます。
- **30GB 制限のハンドリング**:
  - S3 モードでは CloudFront の単一オブジェクト制限（30GiB）を事前に検証し、超過ファイルによるキャッシュエラーを防止します（`--allow-large-files` でバイパス可能）。
  - オンプレミスモードではサイズ制限がなく、テラバイト級までそのまま保存・配信可能です。

