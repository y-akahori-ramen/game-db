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

## `auth-cookie/index.py`

### Route / behavior

- Intended route: `GET /api/auth/cookie`
- Assumes API Gateway REST API + Cognito authorizer has already authenticated the caller.
- Returns CloudFront signed-cookie `Set-Cookie` headers for `/data/*` via `multiValueHeaders`:
  - `CloudFront-Policy`
  - `CloudFront-Signature`
  - `CloudFront-Key-Pair-Id`

### Required environment variables

- `SIGNING_KEY_SECRET_ARN`
  - Set from `signingKeys.privateKeySecret.secretArn` (or secret name).
- `CLOUDFRONT_KEY_PAIR_ID`
  - Set from `signingKeys.publicKey.publicKeyId`.
- `CLOUDFRONT_DOMAIN`
  - Set to the CloudFront distribution domain name, e.g. `d123456abcdef8.cloudfront.net`.
- `COOKIE_TTL_SECONDS`
  - Optional. Default `43200` (12 hours).

### IAM permissions

Grant the Lambda execution role:

- `secretsmanager:GetSecretValue`
  - Scope to `signingKeys.privateKeySecret.secretArn` only.

### Packaging requirement

This handler imports `cryptography` to produce CloudFront's required RSA-SHA1 signature.
AWS Lambda Python runtimes do not bundle `cryptography` by default, so the wiring step must do one of the following:

- Preferably create the function with a bundling construct such as `PythonFunction` that installs `infra/lambda/auth-cookie/requirements.txt` into the deployment artifact.
- Or attach a Lambda Layer that contains a runtime-compatible build of `cryptography`.

If using `PythonFunction`, remember the CDK app does not currently depend on `@aws-cdk/aws-lambda-python-alpha`, so that package may need to be added at a version compatible with the installed CDK release.

## Sandbox-safe packaging note for `auth-cookie`

This repository's current CDK wiring uses plain `lambda.Code.fromAsset('infra/lambda/auth-cookie')`
so that `npm run build` and `cdk synth` stay Docker-free in environments where Docker is not
available. That means `cryptography` is **not** installed automatically during synth.

Before a real deploy, package the dependency into the asset directory (or provide an equivalent
runtime-compatible Lambda Layer) yourself, for example:

```sh
pip install -r infra/lambda/auth-cookie/requirements.txt -t infra/lambda/auth-cookie/vendor
```

If you vendor into `vendor/`, also ensure the handler package path includes that directory or switch
the function to a proper bundling flow. In a non-sandboxed CI/developer environment with Docker
available, the preferred follow-up is to replace the plain asset wiring with `PythonFunction`
(`@aws-cdk/aws-lambda-python-alpha`) so requirements are installed automatically as part of the
deployment artifact build.
