# Game QA Dashboard CDK app [DEPRECATED / RETIRED]

> **警告 / WARNING: 本 CDK スタックは廃止（Retired）されました**  
> `docs/architecture-improvement-plan.md` (Phase 3) に基づき、検索インデックスは AWS DynamoDB からオンプレミス組み込みの **SQLite (WALモード)** へ完全に移行しました。
> 現在の本番運用環境（Docker Compose）では AWS クラウドリソース（DynamoDB、専用 IAM ユーザー、ポリシー）は一切使用されていません。

---

## 既存 AWS クラウドリソースの破棄手順 (Teardown / Decommission)

過去に本 CDK スタックを AWS アカウントにデプロイしていた場合は、不要なクラウドリソースおよびコストを削減するため、以下のコマンドでスタックを破棄（削除）してください。

### 前提条件

- Node.js (v20+)
- AWS CLI & AWS CDK v2 (`npm install -g aws-cdk`)
- デプロイ先の AWS 認証情報（`AWS_PROFILE` または環境変数 `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`）

### 破棄コマンド

```sh
cd infra
npm install

# 破棄の実行 (DynamoDB テーブルおよび IAM ユーザーの削除)
npx cdk destroy GameQaDashboardStack
```

> **注意**: DynamoDB テーブルの RemovalPolicy が `RETAIN` に設定されていた場合は、AWS マネジメントコンソールまたは AWS CLI（`aws dynamodb delete-table --table-name GameQaDashboard-SearchIndex`）から手動でテーブルを削除してください。

---

## 移行先アーキテクチャ

オンプレミス環境（`onprem/`）内で稼働する **FastAPI + SQLite (WALモード)** により、すべての検索・メタデータ管理がローカルストレージ（`/data/db/qa.db`）上で完結しています。
詳細は以下を参照してください：
- [`docs/architecture-improvement-plan.md`](../docs/architecture-improvement-plan.md)
- [`onprem/backend/`](../onprem/backend/)
