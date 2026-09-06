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
# Optional: Set GOOGLE_CLIENT_ID to provision the IAM OIDC provider and QA upload CLI role
export GOOGLE_CLIENT_ID="your-desktop-client-id.apps.googleusercontent.com"
npx cdk deploy --all
```
