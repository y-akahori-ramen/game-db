import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

export interface SigningKeysProps {}

export class SigningKeys extends Construct {
  public readonly keyGroup: cloudfront.KeyGroup;
  public readonly publicKey: cloudfront.PublicKey;
  public readonly privateKeySecret: secretsmanager.ISecret;

  constructor(scope: Construct, id: string, props?: SigningKeysProps) {
    super(scope, id);

    void props;

    const stack = cdk.Stack.of(this);
    const secretName = `${stack.stackName}/cloudfront-signing-key`;

    const privateKeySecret = new secretsmanager.Secret(this, 'PrivateKeySecret', {
      description: 'CloudFront signed-cookie key pair for /data/* access. Current version is managed by a custom resource.',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      secretName,
    });

    const onEventHandler = new lambda.Function(this, 'SigningKeyGeneratorFunction', {
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'signing-key-generator')),
      handler: 'index.onEvent',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(30),
    });

    onEventHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'secretsmanager:DescribeSecret',
          'secretsmanager:GetSecretValue',
          'secretsmanager:PutSecretValue',
        ],
        resources: [privateKeySecret.secretArn],
      }),
    );

    const provider = new cr.Provider(this, 'SigningKeyProvider', {
      onEventHandler,
    });

    const signingKeyResource = new cdk.CustomResource(this, 'SigningKeyResource', {
      resourceType: 'Custom::CloudFrontSigningKeyPair',
      serviceToken: provider.serviceToken,
      properties: {
        SecretArn: privateKeySecret.secretArn,
      },
    });

    const publicKey = new cloudfront.PublicKey(this, 'PublicKey', {
      encodedKey: signingKeyResource.getAttString('PublicKeyPem'),
    });

    this.keyGroup = new cloudfront.KeyGroup(this, 'KeyGroup', {
      items: [publicKey],
    });
    this.publicKey = publicKey;
    this.privateKeySecret = privateKeySecret;
  }
}
