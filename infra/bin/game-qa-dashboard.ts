#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { GameQaDashboardStack } from '../lib/main-stack';

const app = new cdk.App();
const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION || 'ap-northeast-1';

// Single-region stack (Tokyo) managing only the AWS DynamoDB search index
// and the least-privilege IAM User for the on-premises Docker Compose backend.
new GameQaDashboardStack(app, 'GameQaDashboardStack', {
  env: {
    account,
    region,
  },
  tableName: process.env.TABLE_NAME || 'GameQaDashboard-SearchIndex',
});
