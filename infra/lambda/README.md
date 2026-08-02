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

### Required environment variables
- `ATHENA_WORKGROUP_NAME`
  - Set from `analytics.workGroup.name` (currently `game-qa-dashboard-search`).
- `ATHENA_CATALOG_NAME`
  - Set to `"${analytics.s3TablesCatalogName}/aws-s3"`, which is expected to be `s3tablescatalog/aws-s3`.
- `ATHENA_DATABASE_NAME`
  - Set to the S3 Metadata bucket namespace name used by Athena. Per AWS docs the annotation table naming convention is `"s3tablescatalog/aws-s3"."b_<bucket-name>"."annotation"`, so this env var should be `b_${storage.dataBucket.bucketName}` (keep hyphens; the code quotes identifiers).
- `ATHENA_TABLE_NAME`
  - Optional. Defaults to `annotation`.
- `ATHENA_OUTPUT_LOCATION`
  - Optional if the workgroup enforces a result location. If you want the function to be explicit, set it to `s3://${analytics.queryResultsBucket.bucketName}/athena-results/`.
- `QUERY_POLL_INTERVAL_SECONDS`
  - Optional. Default `1.0`.
- `QUERY_TIMEOUT_SECONDS`
  - Optional. Default `30`.

### IAM permissions
Grant the Lambda execution role:
- Athena:
  - `athena:StartQueryExecution`
  - `athena:GetQueryExecution`
  - `athena:GetQueryResults`
  - `athena:StopQueryExecution`
  - `athena:GetWorkGroup`
- Scope Athena permissions to the specific workgroup ARN where possible.
- S3 on the Athena query-results bucket:
  - `s3:GetObject`
  - `s3:PutObject`
  - `s3:ListBucket`
- Glue / Athena catalog access for the S3 Metadata annotation table:
  - `glue:GetDatabase`
  - `glue:GetDatabases`
  - `glue:GetTable`
  - `glue:GetTables`
  - `glue:GetPartition`
  - `glue:GetPartitions`
- Lake Formation note:
  - `infra/lib/analytics.ts` creates the federated catalog with `createDatabaseDefaultPermissions` and `createTableDefaultPermissions` for `IAM_ALLOWED_PRINCIPALS`, so ordinary IAM-based access should work as long as those defaults remain unchanged.
  - If Lake Formation permissions are later tightened, this role must also be granted access to the federated catalog/database/table corresponding to `"s3tablescatalog/aws-s3"."b_<bucket-name>"."annotation"`.

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
