import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface GameQaDashboardStackProps extends cdk.StackProps {
  /**
   * DynamoDB table name for the run search index.
   * Defaults to 'GameQaDashboard-SearchIndex'.
   */
  readonly tableName?: string;
  /**
   * IAM User name for the on-premises Docker Compose backend.
   * Defaults to 'GameQaDashboardOnpremUser'.
   */
  readonly onpremUserName?: string;
}

/**
 * Game QA Dashboard AWS Stack (On-Premises Hybrid Architecture).
 *
 * Manages only the AWS-side resources:
 * 1. DynamoDB Table for the run search index with 3 GSIs.
 * 2. Dedicated IAM User and minimal policy for the on-premises backend.
 *
 * All storage (S3) and web hosting (CloudFront, Lambda@Edge, API Gateway)
 * have been migrated to the on-premises DMZ environment.
 */
export class GameQaDashboardStack extends cdk.Stack {
  public readonly table: dynamodb.Table;
  public readonly onpremUser: iam.User;

  constructor(scope: Construct, id: string, props: GameQaDashboardStackProps = {}) {
    super(scope, id, props);

    const tableName = props.tableName ?? 'GameQaDashboard-SearchIndex';
    const onpremUserName = props.onpremUserName ?? 'GameQaDashboardOnpremUser';

    // 1. DynamoDB Table with GSIs for run search index
    this.table = new dynamodb.Table(this, 'RunSearchIndexTable', {
      tableName,
      partitionKey: { name: 'runId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    this.table.addGlobalSecondaryIndex({
      indexName: 'platform-index',
      partitionKey: { name: 'platform', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'executedAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.table.addGlobalSecondaryIndex({
      indexName: 'status-index',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'executedAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.table.addGlobalSecondaryIndex({
      indexName: 'all-index',
      partitionKey: { name: 'gsiAllPk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'executedAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // 2. Dedicated IAM User for On-Premises Docker Compose backend
    this.onpremUser = new iam.User(this, 'OnpremBackendUser', {
      userName: onpremUserName,
    });

    // 3. Least-privilege IAM Policy for DynamoDB search index access
    const dynamoDbPolicy = new iam.Policy(this, 'OnpremDynamoDbPolicy', {
      policyName: 'GameQaDashboardOnpremDynamoDbAccess',
      statements: [
        new iam.PolicyStatement({
          sid: 'DynamoDBReadWriteAccessForGameQaDashboard',
          effect: iam.Effect.ALLOW,
          actions: [
            'dynamodb:GetItem',
            'dynamodb:PutItem',
            'dynamodb:UpdateItem',
            'dynamodb:DeleteItem',
            'dynamodb:Query',
            'dynamodb:Scan',
            'dynamodb:BatchGetItem',
            'dynamodb:BatchWriteItem',
            'dynamodb:DescribeTable',
          ],
          resources: [
            this.table.tableArn,
            `${this.table.tableArn}/index/*`,
          ],
        }),
      ],
    });

    dynamoDbPolicy.attachToUser(this.onpremUser);

    // 4. CloudFormation Outputs
    new cdk.CfnOutput(this, 'TableName', {
      value: this.table.tableName,
      description: 'DynamoDB table name for run search index.',
    });

    new cdk.CfnOutput(this, 'TableArn', {
      value: this.table.tableArn,
      description: 'DynamoDB table ARN.',
    });

    new cdk.CfnOutput(this, 'OnpremUserName', {
      value: this.onpremUser.userName,
      description: 'IAM User name for on-premises backend. Generate an Access Key for onprem/.env.',
    });

    new cdk.CfnOutput(this, 'OnpremUserArn', {
      value: this.onpremUser.userArn,
      description: 'IAM User ARN for on-premises backend.',
    });
  }
}

// Export as MainStack for backward compatibility with existing scripts/tests
export { GameQaDashboardStack as MainStack };
export type { GameQaDashboardStackProps as MainStackProps };
