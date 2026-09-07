# Game QA Dashboard CDK app

社内オンプレミス環境と連携する AWS クラウドリソース（DynamoDB 検索インデックスおよびオンプレミス専用 IAM ユーザー）を管理する CDK アプリケーションです。

## 前提条件

- Node.js (v20+)
- AWS CLI & AWS CDK v2 (`npm install -g aws-cdk`)
- 対象 AWS アカウントのブートストラップ（単一リージョン: `ap-northeast-1`）

## インストール

```sh
cd infra
npm install
```

## 管理リソース (`lib/main-stack.ts`)

1. **DynamoDB テーブル** (`GameQaDashboard-SearchIndex`):
   - パーティションキー: `runId` (String)
   - 課金モード: `PAY_PER_REQUEST`（オンデマンド）
   - ポイントインタイムリカバリ (PITR): 有効
   - GSI (3つ):
     - `platform-index` (PK: `platform`, SK: `executedAt`)
     - `status-index` (PK: `status`, SK: `executedAt`)
     - `all-index` (PK: `gsiAllPk`, SK: `executedAt`)
2. **オンプレミス連携専用 IAM ユーザー** (`GameQaDashboardOnpremUser`):
   - オンプレミス Docker Compose バックエンドから DynamoDB へ最小権限で接続するための IAM ユーザー。
3. **最小権限 IAM ポリシー** (`GameQaDashboardOnpremDynamoDbAccess`):
   - 対象テーブルおよび GSI に対する CRUD / Query / Scan のみを許可（[`onprem-dynamodb-policy.json`](onprem-dynamodb-policy.json) 準拠）。

## テンプレート合成 (Synthesize)

```sh
npx cdk synth
```

## デプロイ (Deploy)

```sh
# 必要に応じてテーブル名を環境変数でカスタマイズ可能 (デフォルト: GameQaDashboard-SearchIndex)
export TABLE_NAME="GameQaDashboard-SearchIndex"

npx cdk deploy
```

### デプロイ後のセットアップ

1. **IAM アクセスキーの発行**:
   - デプロイ完了後、作成された IAM ユーザー (`GameQaDashboardOnpremUser`) のアクセスキー（Access Key ID / Secret Access Key）を AWS マネジメントコンソールまたは AWS CLI で発行します。

2. **オンプレミス環境への設定**:
   - 発行したクレデンシャルを `onprem/.env` に設定します：
     ```env
     AWS_ACCESS_KEY_ID=AKIA...
     AWS_SECRET_ACCESS_KEY=...
     AWS_DEFAULT_REGION=ap-northeast-1
     TABLE_NAME=GameQaDashboard-SearchIndex
     ```
   - その後、オンプレミス環境を起動します：
     ```sh
     docker compose -f onprem/docker-compose.yml up -d
     ```
