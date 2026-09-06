import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import { BLOCKED_IPS } from './blocked-ips';

export interface EdgeStackProps extends cdk.StackProps {
  /**
   * Google OAuth 2.0 Web Application Client ID for Lambda@Edge OIDC authentication.
   */
  readonly googleClientId?: string;
  /**
   * Google OAuth 2.0 Client Secret for Lambda@Edge code exchange.
   */
  readonly googleClientSecret?: string;
  /**
   * Optional Google Workspace hosted domain (hd) to restrict access (e.g. example.com).
   */
  readonly googleAllowedDomain?: string;
  /**
   * Optional comma-separated list of allowed Google account emails.
   */
  readonly googleAllowedEmails?: string;
}

export class EdgeStack extends cdk.Stack {
  public readonly ipSet: wafv2.CfnIPSet;
  public readonly webAclArn: string;
  public readonly googleOidcSecret: secretsmanager.ISecret;
  public readonly edgeAuthFunction: lambda.Function;
  public readonly edgeAuthVersion: lambda.IVersion;

  constructor(scope: Construct, id: string, props: EdgeStackProps = {}) {
    super(scope, id, props);

    this.ipSet = new wafv2.CfnIPSet(this, 'BlockedIpsIpSet', {
      name: 'GameQaDashboardBlockedIps',
      scope: 'CLOUDFRONT',
      ipAddressVersion: 'IPV4',
      addresses: BLOCKED_IPS,
      description: 'Blocked IPv4 addresses for the Game QA Dashboard CloudFront WAF.',
    });

    const webAcl = new wafv2.CfnWebACL(this, 'WebAcl', {
      name: 'GameQaDashboardEdgeWebAcl',
      scope: 'CLOUDFRONT',
      defaultAction: {
        allow: {},
      },
      rules: [
        {
          name: 'BlockConfiguredIps',
          priority: 0,
          statement: {
            ipSetReferenceStatement: {
              arn: this.ipSet.attrArn,
            },
          },
          action: {
            block: {},
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'GameQaDashboardBlockedIpsRule',
            sampledRequestsEnabled: true,
          },
        },
      ],
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'GameQaDashboardEdgeWebAcl',
        sampledRequestsEnabled: true,
      },
    });

    this.webAclArn = webAcl.attrArn;

    new cdk.CfnOutput(this, 'WebAclArn', {
      value: this.webAclArn,
      description: 'ARN of the CloudFront-scope WAFv2 Web ACL.',
    });

    // AWS Secrets Manager secret holding Google OAuth 2.0 configuration for Lambda@Edge
    this.googleOidcSecret = new secretsmanager.Secret(this, 'GoogleOidcSecret', {
      secretName: 'GameQaDashboard/GoogleOidcConfig',
      description: 'Google OAuth 2.0 configuration for Game QA Dashboard Lambda@Edge OIDC authentication.',
      secretObjectValue: {
        clientId: cdk.SecretValue.unsafePlainText(
          props.googleClientId ?? process.env.GOOGLE_CLIENT_ID ?? ''
        ),
        clientSecret: cdk.SecretValue.unsafePlainText(
          props.googleClientSecret ?? process.env.GOOGLE_CLIENT_SECRET ?? ''
        ),
        allowedDomain: cdk.SecretValue.unsafePlainText(
          props.googleAllowedDomain ?? process.env.GOOGLE_ALLOWED_DOMAIN ?? ''
        ),
        allowedEmails: cdk.SecretValue.unsafePlainText(
          props.googleAllowedEmails ?? process.env.GOOGLE_ALLOWED_EMAILS ?? ''
        ),
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Lambda@Edge Viewer Request execution role (assumed by both lambda and edgelambda)
    const edgeRole = new iam.Role(this, 'EdgeAuthRole', {
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('lambda.amazonaws.com'),
        new iam.ServicePrincipal('edgelambda.amazonaws.com'),
      ),
      description: 'Execution role for Game QA Dashboard Lambda@Edge OIDC authentication.',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    this.googleOidcSecret.grantRead(edgeRole);

    this.edgeAuthFunction = new lambda.Function(this, 'EdgeAuthFunction', {
      role: edgeRole,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'edge-auth')),
      timeout: cdk.Duration.seconds(5),
      memorySize: 256,
      description: 'Lambda@Edge viewer request handler for Google OIDC authentication.',
    });

    this.edgeAuthVersion = this.edgeAuthFunction.currentVersion;

    new cdk.CfnOutput(this, 'EdgeAuthVersionArn', {
      value: this.edgeAuthVersion.functionArn,
      description: 'ARN of the published Lambda@Edge OIDC authentication function version.',
    });

    new cdk.CfnOutput(this, 'GoogleOidcSecretArn', {
      value: this.googleOidcSecret.secretArn,
      description: 'ARN of the Secrets Manager secret holding Google OIDC configuration.',
    });
  }
}
