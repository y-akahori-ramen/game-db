import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import { BLOCKED_IPS } from './blocked-ips';
import { SearchIndex } from './search-index';
import { Storage } from './storage';

export interface MainStackProps extends cdk.StackProps {
  readonly edgeWebAclArn: string;
  /**
   * Published Lambda@Edge OIDC authentication function version from EdgeStack (us-east-1).
   * When provided, protects SPA routes, /data/*, and /api/* via viewer request authentication.
   */
  readonly edgeAuthVersion?: lambda.IVersion;
  /**
   * Google OAuth 2.0 Client ID for the QA upload CLI.
   * When provided, creates an IAM OIDC Provider for accounts.google.com and an IAM Role
   * allowing the CLI to assume upload permissions via STS AssumeRoleWithWebIdentity.
   */
  readonly googleClientId?: string;
}

export class MainStack extends cdk.Stack {
  public readonly storage: Storage;
  public readonly searchIndex: SearchIndex;
  public readonly searchFunction: lambda.Function;
  public readonly restApi: apigateway.RestApi;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: MainStackProps) {
    super(scope, id, props);

    this.storage = new Storage(this, 'Storage');

    this.searchIndex = new SearchIndex(this, 'SearchIndex', {
      dataBucket: this.storage.dataBucket,
    });

    const lambdaSourceRoot = path.join(__dirname, '..', 'lambda');

    this.searchFunction = new lambda.Function(this, 'SearchFunction', {
      code: lambda.Code.fromAsset(path.join(lambdaSourceRoot, 'search')),
      handler: 'index.handler',
      runtime: lambda.Runtime.PYTHON_3_13,
      timeout: cdk.Duration.seconds(30),
      environment: {
        TABLE_NAME: this.searchIndex.table.tableName,
      },
    });

    this.searchIndex.table.grantReadData(this.searchFunction);

    this.restApi = new apigateway.RestApi(this, 'RestApi', {
      restApiName: 'game-qa-dashboard-api',
      description: 'REST API for the Game QA Dashboard search endpoint.',
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

    const edgeLambdas: cloudfront.EdgeLambda[] | undefined = props.edgeAuthVersion
      ? [
        {
          functionVersion: props.edgeAuthVersion,
          eventType: cloudfront.LambdaEdgeEventType.VIEWER_REQUEST,
        },
      ]
      : undefined;

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.storage.spaBucket, {
          originAccessControl: spaOriginAccessControl,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        edgeLambdas,
      },
      additionalBehaviors: {
        'data/*': {
          origin: origins.S3BucketOrigin.withOriginAccessControl(this.storage.dataBucket, {
            originAccessControl: dataOriginAccessControl,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          edgeLambdas,
        },
        'api/*': {
          origin: new origins.RestApiOrigin(this.restApi),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          edgeLambdas,
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

    // Syncs my-qa-dashboard/dist (must be built beforehand, see infra/README.md) to the SPA bucket
    // and invalidates the CloudFront cache so `cdk deploy` picks up webapp changes on every run.
    new s3deploy.BucketDeployment(this, 'SpaDeployment', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '..', '..', 'my-qa-dashboard', 'dist'))],
      destinationBucket: this.storage.spaBucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
    });

    const apiResource = this.restApi.root.addResource('api');
    const searchResource = apiResource.addResource('search');
    searchResource.addMethod('POST', new apigateway.LambdaIntegration(this.searchFunction), {
      authorizationType: apigateway.AuthorizationType.NONE,
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

    // CloudFront fronts the SPA bucket, data objects (/data/*), and the /api/* REST API.
    // All routes are protected at the edge by Lambda@Edge Google OIDC authentication.
    // In addition, the REST API is protected by a REGIONAL WAF mirroring the shared BLOCKED_IPS.

    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: this.distribution.distributionDomainName,
    });

    new cdk.CfnOutput(this, 'AppUrl', {
      value: `https://${this.distribution.distributionDomainName}`,
    });

    const googleClientId = props.googleClientId ?? process.env.GOOGLE_CLIENT_ID;
    if (googleClientId) {
      const googleProvider = new iam.OpenIdConnectProvider(this, 'GoogleOidcProvider', {
        url: 'https://accounts.google.com',
        clientIds: [googleClientId],
      });

      const cliUploadRole = new iam.Role(this, 'CliUploadRole', {
        roleName: 'GameQaDashboardCliUploadRole',
        assumedBy: new iam.FederatedPrincipal(
          googleProvider.openIdConnectProviderArn,
          {
            StringEquals: {
              'accounts.google.com:aud': googleClientId,
            },
          },
          'sts:AssumeRoleWithWebIdentity',
        ),
        description:
          'IAM Role assumed by the QA upload CLI via Google Account OIDC (STS AssumeRoleWithWebIdentity).',
      });

      this.storage.dataBucket.grantWrite(cliUploadRole, 'runs/*');

      new cdk.CfnOutput(this, 'CliUploadRoleArn', {
        value: cliUploadRole.roleArn,
        description: 'IAM Role ARN for QA upload CLI (passed via --role-arn).',
      });
    }
  }
}
