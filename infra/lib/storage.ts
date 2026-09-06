import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface StorageProps {
  readonly glacierTransitionDays?: number;
}

export class Storage extends Construct {
  public readonly spaBucket: s3.Bucket;
  public readonly dataBucket: s3.Bucket;

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
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
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
  }
}
