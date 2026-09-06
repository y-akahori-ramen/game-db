#!/usr/bin/env bash
# LocalStack initialization script: runs when LocalStack is ready.
# Creates the S3 data bucket and the DynamoDB search index table with GSIs.

set -euo pipefail

echo "Initializing LocalStack resources for Game QA Dashboard..."

# 1. Create S3 Bucket
awslocal s3 mb s3://qa-data --region ap-northeast-1 || true

# 2. Create DynamoDB Table with GSIs matching infra/lib/search-index.ts
awslocal dynamodb create-table \
    --table-name GameQaDashboard-SearchIndex \
    --region ap-northeast-1 \
    --attribute-definitions \
        AttributeName=runId,AttributeType=S \
        AttributeName=platform,AttributeType=S \
        AttributeName=status,AttributeType=S \
        AttributeName=gsiAllPk,AttributeType=S \
        AttributeName=executedAt,AttributeType=S \
    --key-schema \
        AttributeName=runId,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --global-secondary-indexes \
        "[
            {
                \"IndexName\": \"platform-index\",
                \"KeySchema\": [
                    {\"AttributeName\": \"platform\", \"KeyType\": \"HASH\"},
                    {\"AttributeName\": \"executedAt\", \"KeyType\": \"RANGE\"}
                ],
                \"Projection\": {\"ProjectionType\": \"ALL\"}
            },
            {
                \"IndexName\": \"status-index\",
                \"KeySchema\": [
                    {\"AttributeName\": \"status\", \"KeyType\": \"HASH\"},
                    {\"AttributeName\": \"executedAt\", \"KeyType\": \"RANGE\"}
                ],
                \"Projection\": {\"ProjectionType\": \"ALL\"}
            },
            {
                \"IndexName\": \"all-index\",
                \"KeySchema\": [
                    {\"AttributeName\": \"gsiAllPk\", \"KeyType\": \"HASH\"},
                    {\"AttributeName\": \"executedAt\", \"KeyType\": \"RANGE\"}
                ],
                \"Projection\": {\"ProjectionType\": \"ALL\"}
            }
        ]" || true

echo "LocalStack resources initialized successfully!"

