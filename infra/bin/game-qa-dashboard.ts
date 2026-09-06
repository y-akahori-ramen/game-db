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
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  googleAllowedDomain: process.env.GOOGLE_ALLOWED_DOMAIN,
  googleAllowedEmails: process.env.GOOGLE_ALLOWED_EMAILS,
});

new MainStack(app, 'GameQaDashboardMainStack', {
  env: {
    account,
    region: 'ap-northeast-1',
  },
  crossRegionReferences: true,
  edgeWebAclArn: edgeStack.webAclArn,
  edgeAuthVersion: edgeStack.edgeAuthVersion,
  googleClientId: process.env.GOOGLE_CLIENT_ID,
});

