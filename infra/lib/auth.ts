import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export interface AuthProps {
  readonly domainPrefix: string;
  // Hosted UI redirects must use the CloudFront distribution domain so SPA, /data/*,
  // and /api/* share the same cookie domain.
  readonly callbackUrls: string[];
  readonly logoutUrls: string[];
}

export class Auth extends Construct {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolDomain: cognito.UserPoolDomain;
  public readonly spaClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthProps) {
    super(scope, id);

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: false,
      signInAliases: {
        email: true,
      },
      autoVerify: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.userPoolDomain = new cognito.UserPoolDomain(this, 'UserPoolDomain', {
      userPool: this.userPool,
      cognitoDomain: {
        domainPrefix: props.domainPrefix,
      },
    });

    this.spaClient = new cognito.UserPoolClient(this, 'SpaClient', {
      userPool: this.userPool,
      authFlows: {},
      generateSecret: false,
      preventUserExistenceErrors: true,
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: props.callbackUrls,
        logoutUrls: props.logoutUrls,
      },
    });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
    });

    new cdk.CfnOutput(this, 'SpaClientId', {
      value: this.spaClient.userPoolClientId,
    });

    new cdk.CfnOutput(this, 'HostedUiBaseUrl', {
      value: this.userPoolDomain.baseUrl(),
    });
  }
}
