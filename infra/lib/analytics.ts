import * as cdk from 'aws-cdk-lib';
import * as athena from 'aws-cdk-lib/aws-athena';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface AnalyticsProps {
  readonly dataBucket: s3.IBucket;
}

export class Analytics extends Construct {
  public readonly queryResultsBucket: s3.Bucket;
  public readonly workGroup: athena.CfnWorkGroup;
  public readonly s3TablesCatalog: glue.CfnCatalog;
  public readonly s3TablesCatalogName: string;

  constructor(scope: Construct, id: string, props: AnalyticsProps) {
    super(scope, id);

    this.queryResultsBucket = new s3.Bucket(this, 'AthenaQueryResultsBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(7),
        },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    this.workGroup = new athena.CfnWorkGroup(this, 'SearchWorkGroup', {
      name: 'game-qa-dashboard-search',
      description: 'Athena workgroup for Game QA Dashboard search queries over the S3 Metadata annotation table.',
      recursiveDeleteOption: true,
      state: 'ENABLED',
      workGroupConfiguration: {
        enforceWorkGroupConfiguration: true,
        engineVersion: {
          selectedEngineVersion: 'AUTO',
        },
        publishCloudWatchMetricsEnabled: true,
        resultConfiguration: {
          outputLocation: `s3://${this.queryResultsBucket.bucketName}/athena-results/`,
        },
      },
    });

    this.s3TablesCatalogName = 's3tablescatalog';

    // aws-cdk-lib 2.263.0 already includes the AWS::Glue::Catalog L1 with the
    // FederatedCatalog shape, and AWS's S3 Tables integration guide uses exactly
    // ConnectionName=aws:s3tables plus the account/region bucket ARN wildcard.
    // That means native CloudFormation/CDK is sufficient here; no custom resource
    // is needed just to bootstrap the federated catalog.
    this.s3TablesCatalog = new glue.CfnCatalog(this, 'S3TablesCatalog', {
      name: this.s3TablesCatalogName,
      description: `Federated catalog for Amazon S3 Tables / S3 Metadata in ${props.dataBucket.bucketName}.`,
      federatedCatalog: {
        connectionName: 'aws:s3tables',
        identifier: `arn:${cdk.Aws.PARTITION}:s3tables:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:bucket/*`,
      },
      createDatabaseDefaultPermissions: [
        {
          principal: {
            dataLakePrincipalIdentifier: 'IAM_ALLOWED_PRINCIPALS',
          },
          permissions: ['ALL'],
        },
      ],
      createTableDefaultPermissions: [
        {
          principal: {
            dataLakePrincipalIdentifier: 'IAM_ALLOWED_PRINCIPALS',
          },
          permissions: ['ALL'],
        },
      ],
    });
  }
}
