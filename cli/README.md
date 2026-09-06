# QA Upload CLI

Standalone uploader for QA test-run artifacts with Google Account authentication.

## Overview

QA テスト実行アーティファクト（FPS / メモリメトリクス、UE ログ、動画キャプチャ、マニフェスト）を S3 へアップロードする CLI ツールです。

AWS の IAM アクセスキーを開発者・テスター端末に配布することなく、**Google アカウント認証**（OAuth 2.0 PKCE）と **AWS STS `AssumeRoleWithWebIdentity`** を利用してセキュアに一時クレデンシャルを取得し、S3 へ直接アップロードします。

- **初回認証**: ブラウザが自動起動し、Google アカウントでログイン・同意します（ヘッドレス環境向けに `--no-browser` もサポート）。
- **次回以降**: ローカルに保存された情報（リフレッシュトークン: `~/.config/game-qa/token.json`）により、**完全非対話・自動** でトークンを更新して動作します。
- **CI / IAM フォールバック**: `--profile` を指定することで、従来の AWS IAM ロール・プロファイルでの実行も可能です。

---

## Prerequisites

- `uv` (Python >= 3.10)
- Google Cloud OAuth 2.0 クライアント ID（デスクトップ アプリケーション種別）
- AWS IAM OIDC ID プロバイダ (`accounts.google.com`) およびアップロード用 IAM ロール

---

## Usage

### 1. 初回ログイン（事前ログイン）

明示的にログインを済ませておきたい場合は `login` サブコマンドを実行します：

```sh
uv run cli/qa_upload.py login \
  --google-client-id "xxxxxx.apps.googleusercontent.com"
```

ブラウザが開くので Google アカウントでログインを完了します。完了後、クレデンシャルが `~/.config/game-qa/token.json` にパーミッション `0600` で保存されます。

※環境変数 `GOOGLE_CLIENT_ID` を設定しておけば、引数を省略できます：

```sh
export GOOGLE_CLIENT_ID="xxxxxx.apps.googleusercontent.com"
uv run cli/qa_upload.py login
```

### 2. テスト結果のアップロード

`upload` サブコマンドを実行します。初回で未ログインの場合は自動的にブラウザ認証が起動します。すでにログイン済みの場合は、**ユーザー操作なし（非対話）** でリフレッシュトークンから ID トークンを自動更新し、アップロードが行われます。

```sh
uv run cli/qa_upload.py upload \
  --bucket qa-data \
  --run-dir ./local_run_folder \
  --run-id run-001 \
  --game-version v1.2.0 \
  --platform PS5 \
  --test-name Level1_Playthrough \
  --result FAILED \
  --avg-fps 54.2 \
  --role-arn "arn:aws:iam::123456789012:role/GameQaUploadRole" \
  --google-client-id "xxxxxx.apps.googleusercontent.com"
```

環境変数で設定しておくことで、日常のコマンドを大幅に短縮できます：

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
  --result PASSED \
  --avg-fps 59.8
```

### 3. 動画トランスコード (`transcode`)

大容量動画（数十GB）をWebダッシュボードで遅延なく快適に再生するために、Web最適化MP4（H.264 / AAC / `faststart` 適用）へ変換します。

```sh
# 単一動画ファイルをトランスコード (例: capture.mp4 -> capture_web.mp4)
uv run cli/qa_upload.py transcode ./local_run_folder/capture.mp4

# ディレクトリ内のすべての元動画を一括トランスコード
uv run cli/qa_upload.py transcode ./local_run_folder/ --resolution 1080p --crf 23
```

※ `upload` コマンド実行時、対象ディレクトリに `*_web.mp4` が存在しない場合は**自動的にトランスコードが実行**されます（すでに存在する場合はトランスコードをスキップして即アップロードに進みます）。

### 4. 認証状態の確認 (`whoami`)

現在ログイン中の Google アカウントやトークンの有効期限を確認できます：

```sh
uv run cli/qa_upload.py whoami
```

出力例:

```text
Google Account: qa-engineer@example.com (sub: 10293847561029384756)
Token cache:    /Users/username/.config/game-qa/token.json
Expires at:     2026-09-06T12:00:00+00:00 (VALID)
Refresh token:  Present (auto-refresh enabled)
```

### 5. ログアウト (`logout`)

キャッシュされた Google 認証情報を削除します：

```sh
uv run cli/qa_upload.py logout
```

---

## Options Reference

### `upload` Options

| オプション | 環境変数 | 説明 |
| --- | --- | --- |
| `--bucket` | — | アップロード先 S3 バケット名（必須） |
| `--run-dir` | — | アップロード対象ファイルが格納されたディレクトリ（必須） |
| `--run-id` | — | 実行識別子（例: `run-001`）（必須） |
| `--game-version` | — | ゲームバージョン（必須） |
| `--platform` | — | プラットフォーム（例: `PS5`, `Windows`）（必須） |
| `--test-name` | — | テストケース名（必須） |
| `--result` | — | 結果 (`PASSED` または `FAILED`)（必須） |
| `--avg-fps` | — | 平均 FPS（必須） |
| `--executed-at` | — | 実行時刻（UTC ISO8601、省略時は現在時刻） |
| `--skip-transcode` | — | Web最適化動画が存在しない場合でも自動トランスコードをスキップする |
| `--force-transcode` | — | 既存のWeb最適化動画があっても強制的に再トランスコードする |
| `--role-arn` | `GAME_QA_UPLOAD_ROLE_ARN` | Google Web Identity で Assume する IAM ロール ARN |
| `--google-client-id` | `GOOGLE_CLIENT_ID` | Google OAuth 2.0 クライアント ID |
| `--google-client-secret` | `GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 クライアントシークレット（デスクトップアプリでは通常不要） |
| `--token-cache` | `GAME_QA_TOKEN_CACHE` | トークン保存先（デフォルト: `~/.config/game-qa/token.json`） |
| `--no-browser` | — | ブラウザを自動起動せず、ターミナルにログイン URL を表示する |
| `--profile` | — | 従来の AWS プロファイル（Google 認証ではなく IAM で実行する場合に使用） |
| `--region` | — | AWS リージョン（デフォルト: `ap-northeast-1`） |

### `transcode` Options

| オプション | デフォルト | 説明 |
| --- | --- | --- |
| `source` | （必須） | 入力動画ファイルパス、または動画を含むディレクトリパス |
| `-o`, `--output` | `<stem>_web.mp4` | 出力ファイルパス（単一ファイル変換時のみ） |
| `--resolution` | `1080p` | 出力解像度 (`1080p`, `720p`, `original`) |
| `--crf` | `23` | x264 の品質係数（CRF値、小さいほど高品質） |
| `--preset` | `fast` | x264 エンコードプリセット |
| `-f`, `--force` | `false` | 出力先が既に存在する場合でも強制的に上書き再エンコード |

---

## Behavior & Safety

- **30GB 単一ファイル上限チェック (CloudFront制限)**:
  - アップロード前に全ファイルのサイズを検証します。
  - CloudFront の単一オブジェクト制限である **30 GB (30 GiB)** を超えるファイルが存在する場合、アップロードを即座に中止しエラーを表示します。
- **動画トランスコードの自動連携**:
  - 元動画ファイル（`capture.mp4`, `video.mp4` 等）を検出した場合、対応する `*_web.mp4` の存在を確認します。
  - 存在しない場合は `ffmpeg` を用いて Web 最適化動画（H.264/AAC, `faststart` 適用）を自動生成します。
  - 生成された Web 用動画と元動画（アーカイブ用）の双方が S3 にアップロードされ、マニフェストには Web 動画が優先されるように登録されます。
- **S3 マルチパート動的チャンクサイズ**:
  - ファイルサイズに応じてチャンクサイズを動的に計算し、S3 の最大 10,000 パーツ制限によるアップロード失敗を回避します。
- **順序保証（アトミックな公開）**:
  - 子ファイル群を先にマルチパートアップロードで PUT します。
  - すべての子ファイルのアップロードが完了した後、最後に `manifest.json` を PUT します。
  - S3 の `ObjectCreated` イベント通知（`suffix: manifest.json`）がトリガーとなり、manifest インデクサ Lambda が DynamoDB 検索インデックスへ自動登録します。
- **依存関係**: PEP 723 インラインメタデータにより、`uv run` 実行時に `boto3` が自動セットアップされます。トランスコードにはローカル環境の `ffmpeg` を使用します。
