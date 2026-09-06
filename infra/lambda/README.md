# Lambda wiring contract

This directory contains standalone Python handlers for the later `api-gateway` wiring step.

## `search/index.py`

### Request / response contract

- Intended route: `POST /api/search`
- Request body JSON shape must match `my-qa-dashboard/src/services/SearchService.ts`:
  - `gameVersion?: string`
  - `platform?: string`
  - `testName?: string`
  - `status?: string`
- The response body is a JSON array of `TestRunSummary` objects with these exact camelCase keys:
  - `runId`
  - `gameVersion`
  - `platform`
  - `testName`
  - `status`
  - `timestamp`
  - `fpsDataUrl`
  - `memoryDataUrl`
  - `logsDataUrl`

### Query strategy

- `platform` given: `Query` on GSI `platform-index` (PK `platform`, SK `executedAt` DESC).
- `status` given (no platform): `Query` on GSI `status-index`.
- No filter: `Query` on GSI `all-index` (fixed PK `ALL`).
- Remaining filter fields are applied with a `FilterExpression`.

### Required environment variables

- `TABLE_NAME`
  - Set from `searchIndex.table.tableName`.
- `MAX_RESULTS`
  - Optional. Default `200`.

### IAM permissions

Grant the Lambda execution role (`searchIndex.table.grantReadData` covers all of this):

- `dynamodb:Query` / `dynamodb:GetItem` on the table and all of its GSIs (`table/*/index/*`).

## `manifest-indexer/index.py`

### Trigger / behavior

- Triggered by S3 `ObjectCreated` events on the data bucket with `prefix: runs/` and
  `suffix: manifest.json` (wired in `infra/lib/search-index.ts`).
- Reads the manifest, validates required fields, and upserts one DynamoDB item per run
  (PK = `runId`, plus `gsiAllPk = "ALL"` for the all-index GSI). Idempotent under event
  redelivery and re-uploads.
- Malformed manifests are logged and skipped so S3's async-invoke retry does not loop.

### Required environment variables

- `TABLE_NAME`
  - Set from `searchIndex.table.tableName`.

### IAM permissions

- `s3:GetObject` on `runs/*` in the data bucket.
- `dynamodb:PutItem` on the table (`table.grantWriteData`).

## `edge-auth/index.js`

### Trigger / behavior

- Deployed as a **Lambda@Edge Viewer Request** function in `us-east-1` (`EdgeStack`).
- Intercepts viewer requests for SPA static files, data artifacts (`/data/*`), and API routes (`/api/*`).
- Handles the OAuth 2.0 callback (`/_callback`):
  1. Exchanges authorization code with Google (`https://oauth2.googleapis.com/token`).
  2. Verifies ID token signature against Google JWKS (`https://www.googleapis.com/oauth2/v3/certs`).
  3. Verifies `aud`, `iss`, expiration, and domain restriction (`hd`) or email allowlist.
  4. Sets session cookie `TOKEN=<id_token>; Path=/; Secure; HttpOnly; SameSite=Lax`.
  5. Redirects (302) to the original requested URL.
- On subsequent requests:
  - Validates `TOKEN` session cookie.
  - If valid, passes through to CloudFront origin (S3 or API Gateway).
  - If unauthenticated:
    - `/api/*`: returns 401 Unauthorized JSON.
    - Browser routes: 302 redirects to Google OAuth 2.0 authorization endpoint (`https://accounts.google.com/o/oauth2/v2/auth`).

### Configuration & Secrets Manager

- Reads Google Client ID, Client Secret, and optional allowedDomain / allowedEmails from Secrets Manager in `us-east-1` (`GameQaDashboard/GoogleOidcConfig`).
- Caches configuration and JWKS public keys in memory across invocations.

### IAM permissions

- AssumeRole policy: `lambda.amazonaws.com` and `edgelambda.amazonaws.com`.
- Managed policy: `service-role/AWSLambdaBasicExecutionRole`.
- Policy: `secretsmanager:GetSecretValue` on the Google OIDC configuration secret.

### Zero-dependency implementation

- Implemented in Node.js 22 using standard library APIs (`node:crypto`, global `fetch`) and the Lambda runtime-bundled `@aws-sdk/client-secrets-manager`.
- Does not require Docker, pip, or external node_modules bundling during `cdk synth` / `cdk deploy`.
