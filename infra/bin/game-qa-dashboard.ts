#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { EdgeStack } from '../lib/edge-stack';
import { MainStack } from '../lib/main-stack';

const app = new cdk.App();
const account = process.env.CDK_DEFAULT_ACCOUNT;

const edgeStack = new EdgeStack(app, 'GameQaDashboardEdgeStack', {
  env: {
    account,
    region: 'us-east-1',
  },
  crossRegionReferences: true,
});

new MainStack(app, 'GameQaDashboardMainStack', {
  env: {
    account,
    region: 'ap-northeast-1',
  },
  crossRegionReferences: true,
  edgeWebAclArn: edgeStack.webAclArn,
});
