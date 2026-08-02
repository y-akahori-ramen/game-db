import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface StorageProps {
  readonly glacierTransitionDays?: number;
}

export class Storage extends Construct {
  public readonly spaBucket: s3.Bucket;
  public readonly dataBucket: s3.Bucket;
  public readonly metadataServiceRole: iam.Role;

  constructor(scope: Construct, id: string, props: StorageProps = {}) {
    super(scope, id);

    const glacierTransitionDays = props.glacierTransitionDays ?? 90;

    this.spaBucket = new s3.Bucket(this, 'SpaBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Rebuildable deployment artifact bucket.
      autoDeleteObjects: true,
    });
    // NOTE(cloudfront): MainStack uses S3BucketOrigin.withOriginAccessControl(), which attaches
    // the CloudFront OAC bucket policy for this bucket automatically during distribution binding.

    this.dataBucket = new s3.Bucket(this, 'DataBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Preserve uploaded QA run artifacts by default.
      lifecycleRules: [
        {
          prefix: 'runs/',
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER_INSTANT_RETRIEVAL,
              transitionAfter: cdk.Duration.days(glacierTransitionDays),
            },
          ],
        },
      ],
    });
    // NOTE(cloudfront): MainStack uses S3BucketOrigin.withOriginAccessControl(), which attaches
    // the CloudFront OAC bucket policy for this bucket automatically during distribution binding.

    this.metadataServiceRole = new iam.Role(this, 'MetadataServiceRole', {
      assumedBy: new iam.ServicePrincipal('metadata.s3.amazonaws.com'),
      description: 'Service role used by Amazon S3 Metadata to read object annotations from the QA data bucket.',
    });

    this.metadataServiceRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          's3:ListBucket',
        ],
        resources: [
          this.dataBucket.bucketArn,
        ],
      }),
    );

    this.metadataServiceRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          's3:GetObject',
          's3:GetObjectVersion',
          's3:GetObjectAnnotation',
          's3:GetObjectVersionAnnotation',
        ],
        resources: [
          this.dataBucket.arnForObjects('*'),
        ],
      }),
    );

    const dataBucketResource = this.dataBucket.node.defaultChild as s3.CfnBucket;
    dataBucketResource.metadataConfiguration = {
      annotationTableConfiguration: {
        configurationState: 'ENABLED',
        role: this.metadataServiceRole.roleArn,
      },
      inventoryTableConfiguration: {
        configurationState: 'DISABLED',
      },
      journalTableConfiguration: {
        recordExpiration: {
          expiration: 'DISABLED',
        },
      },
    };
  }
}
