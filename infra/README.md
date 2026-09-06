# Game QA Dashboard CDK app

## Prerequisites

- Node.js
- AWS CDK v2
- The target AWS account bootstrapped in `ap-northeast-1` and `us-east-1`

## Install

```sh
npm install
```

## Synthesize

```sh
npm --prefix ../my-qa-dashboard run build
npx cdk synth
```

`cdk synth`/`cdk deploy` bundles `my-qa-dashboard/dist` as an asset (`MainStack`'s
`SpaDeployment`), so the webapp must be built first — otherwise synth fails because the
`dist` directory doesn't exist.

## Deploy

```sh
npm --prefix ../my-qa-dashboard run build

# Optional: Set Google OAuth credentials for Lambda@Edge edge authentication and CLI role
export GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
export GOOGLE_CLIENT_SECRET="your-web-client-secret"
# export GOOGLE_ALLOWED_DOMAIN="example.com" # optional: restrict by Google Workspace domain

npx cdk deploy --all
```

After deployment:

- If `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` were not set during deploy, populate them in the AWS Secrets Manager secret `GameQaDashboard/GoogleOidcConfig` in `us-east-1`.
- Register `https://<DistributionDomainName>/_callback` as an Authorized Redirect URI in Google Cloud Console.
