import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import { Analytics } from './analytics';
import { Auth } from './auth';
import { BLOCKED_IPS } from './blocked-ips';
import { SigningKeys } from './signing-keys';
import { Storage } from './storage';

export interface MainStackProps extends cdk.StackProps {
  readonly edgeWebAclArn: string;
  /**
   * Cognito Hosted UI domain prefix. Must be globally unique within the region.
   * Defaults to `game-qa-dashboard-<account-id>` (account-scoped) to minimize collision risk;
   * override explicitly if you still hit a naming conflict.
   */
  readonly cognitoDomainPrefix?: string;
}

export class MainStack extends cdk.Stack {
  public readonly storage: Storage;
  public readonly auth: Auth;
  public readonly signingKeys: SigningKeys;
  public readonly analytics: Analytics;
  public readonly searchFunction: lambda.Function;
  public readonly cookieFunction: lambda.Function;
  public readonly restApi: apigateway.RestApi;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: MainStackProps) {
    super(scope, id, props);

    this.storage = new Storage(this, 'Storage');

    this.signingKeys = new SigningKeys(this, 'SigningKeys');

    this.analytics = new Analytics(this, 'Analytics', {
      dataBucket: this.storage.dataBucket,
    });

    const athenaWorkGroupName = this.analytics.workGroup.name ?? this.analytics.workGroup.ref;
    const athenaCatalogName = `${this.analytics.s3TablesCatalogName}/aws-s3`;
    const athenaDatabaseName = `b_${this.storage.dataBucket.bucketName}`;
    const athenaOutputLocation = `s3://${this.analytics.queryResultsBucket.bucketName}/athena-results/`;
    const lambdaSourceRoot = path.join(__dirname, '..', 'lambda');

    this.searchFunction = new lambda.Function(this, 'SearchFunction', {
      code: lambda.Code.fromAsset(path.join(lambdaSourceRoot, 'search')),
      handler: 'index.handler',
      runtime: lambda.Runtime.PYTHON_3_13,
      timeout: cdk.Duration.seconds(60),
      environment: {
        ATHENA_WORKGROUP_NAME: athenaWorkGroupName,
        ATHENA_CATALOG_NAME: athenaCatalogName,
        ATHENA_DATABASE_NAME: athenaDatabaseName,
        ATHENA_OUTPUT_LOCATION: athenaOutputLocation,
        QUERY_POLL_INTERVAL_SECONDS: '1.0',
        QUERY_TIMEOUT_SECONDS: '30',
      },
    });

    this.analytics.queryResultsBucket.grantReadWrite(this.searchFunction);

    this.searchFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'athena:StartQueryExecution',
          'athena:GetQueryExecution',
          'athena:GetQueryResults',
          'athena:StopQueryExecution',
          'athena:GetWorkGroup',
        ],
        resources: [
          `arn:${cdk.Aws.PARTITION}:athena:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:workgroup/${athenaWorkGroupName}`,
        ],
      }),
    );

    this.searchFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'glue:GetDatabase',
          'glue:GetDatabases',
          'glue:GetTable',
          'glue:GetTables',
          'glue:GetPartition',
          'glue:GetPartitions',
        ],
        // Scoped to the S3 Tables federated catalog (root catalog resource + the named
        // catalog/database/table hierarchy under it), rather than a full-account wildcard.
        resources: [
          `arn:${cdk.Aws.PARTITION}:glue:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:catalog`,
          `arn:${cdk.Aws.PARTITION}:glue:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:catalog/${this.analytics.s3TablesCatalogName}`,
          `arn:${cdk.Aws.PARTITION}:glue:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:database/${this.analytics.s3TablesCatalogName}/*`,
          `arn:${cdk.Aws.PARTITION}:glue:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:table/${this.analytics.s3TablesCatalogName}/*/*`,
        ],
      }),
    );

    // TODO: switch to PythonFunction (@aws-cdk/aws-lambda-python-alpha) for automatic dependency
    // bundling once Docker is available in the build environment; requires adding the matching CDK
    // alpha package and validating cryptography installation during synth/deploy.
    this.cookieFunction = new lambda.Function(this, 'AuthCookieFunction', {
      code: lambda.Code.fromAsset(path.join(lambdaSourceRoot, 'auth-cookie')),
      handler: 'index.handler',
      runtime: lambda.Runtime.PYTHON_3_13,
      timeout: cdk.Duration.seconds(30),
      environment: {
        SIGNING_KEY_SECRET_ARN: this.signingKeys.privateKeySecret.secretArn,
        CLOUDFRONT_KEY_PAIR_ID: this.signingKeys.publicKey.publicKeyId,
        CLOUDFRONT_DOMAIN: 'REPLACE_AFTER_CLOUDFRONT_DEPLOY',
      },
    });
    this.signingKeys.privateKeySecret.grantRead(this.cookieFunction);

    this.restApi = new apigateway.RestApi(this, 'RestApi', {
      restApiName: 'game-qa-dashboard-api',
      description: 'REST API for the Game QA Dashboard search and signed-cookie endpoints.',
      deployOptions: {
        stageName: 'prod',
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [...apigateway.Cors.DEFAULT_HEADERS, 'Authorization'],
      },
    });

    const spaOriginAccessControl = new cloudfront.S3OriginAccessControl(this, 'SpaOriginAccessControl');
    const dataOriginAccessControl = new cloudfront.S3OriginAccessControl(this, 'DataOriginAccessControl');

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.storage.spaBucket, {
          originAccessControl: spaOriginAccessControl,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      additionalBehaviors: {
        'data/*': {
          origin: origins.S3BucketOrigin.withOriginAccessControl(this.storage.dataBucket, {
            originAccessControl: dataOriginAccessControl,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          trustedKeyGroups: [this.signingKeys.keyGroup],
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
        'api/*': {
          origin: new origins.RestApiOrigin(this.restApi),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
      ],
      webAclId: props.edgeWebAclArn,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
    });

    this.auth = new Auth(this, 'Auth', {
      domainPrefix: props.cognitoDomainPrefix ?? `game-qa-dashboard-${cdk.Aws.ACCOUNT_ID}`,
      callbackUrls: [`https://${this.distribution.distributionDomainName}/callback`],
      logoutUrls: [`https://${this.distribution.distributionDomainName}/`],
    });

    this.cookieFunction.addEnvironment('CLOUDFRONT_DOMAIN', this.distribution.distributionDomainName);

    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'ApiAuthorizer', {
      cognitoUserPools: [this.auth.userPool],
    });

    const apiResource = this.restApi.root.addResource('api');
    const searchResource = apiResource.addResource('search');
    searchResource.addMethod('POST', new apigateway.LambdaIntegration(this.searchFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const authResource = apiResource.addResource('auth');
    const cookieResource = authResource.addResource('cookie');
    cookieResource.addMethod('GET', new apigateway.LambdaIntegration(this.cookieFunction), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    const regionalBlockedIps = new wafv2.CfnIPSet(this, 'RegionalBlockedIpsIpSet', {
      name: 'GameQaDashboardRegionalBlockedIps',
      scope: 'REGIONAL',
      ipAddressVersion: 'IPV4',
      addresses: BLOCKED_IPS,
      description: 'Blocked IPv4 addresses for the Game QA Dashboard regional API WAF.',
    });

    const regionalWebAcl = new wafv2.CfnWebACL(this, 'RegionalApiWebAcl', {
      name: 'GameQaDashboardRegionalApiWebAcl',
      scope: 'REGIONAL',
      defaultAction: {
        allow: {},
      },
      rules: [
        {
          name: 'BlockConfiguredIps',
          priority: 0,
          statement: {
            ipSetReferenceStatement: {
              arn: regionalBlockedIps.attrArn,
            },
          },
          action: {
            block: {},
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'GameQaDashboardRegionalBlockedIpsRule',
            sampledRequestsEnabled: true,
          },
        },
      ],
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'GameQaDashboardRegionalApiWebAcl',
        sampledRequestsEnabled: true,
      },
    });

    new wafv2.CfnWebACLAssociation(this, 'RegionalApiWebAclAssociation', {
      resourceArn: this.restApi.deploymentStage.stageArn,
      webAclArn: regionalWebAcl.attrArn,
    });

    // Search and signed-cookie Lambdas are fronted by a Cognito-protected REST API with
    // a REGIONAL WAF that mirrors the shared BLOCKED_IPS source of truth.
    // A single CloudFront distribution now fronts the SPA bucket, signed-cookie-protected
    // /data/* objects, and the /api/* REST API with the shared edge WAF and real app URL wiring.

    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: this.distribution.distributionDomainName,
    });

    new cdk.CfnOutput(this, 'AppUrl', {
      value: `https://${this.distribution.distributionDomainName}`,
    });
  }
}
