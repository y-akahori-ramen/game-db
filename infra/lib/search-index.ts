import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3notifications from 'aws-cdk-lib/aws-s3-notifications';
import { Construct } from 'constructs';

export interface SearchIndexProps {
    readonly dataBucket: s3.Bucket;
}

/**
 * Run search index: a DynamoDB table kept in sync with runs/{run_id}/manifest.json
 * objects via S3 event notifications and the manifest indexer Lambda.
 */
export class SearchIndex extends Construct {
    public readonly table: dynamodb.Table;
    public readonly indexerFunction: lambda.Function;

    constructor(scope: Construct, id: string, props: SearchIndexProps) {
        super(scope, id);

        this.table = new dynamodb.Table(this, 'RunTable', {
            partitionKey: { name: 'runId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.RETAIN, // Rebuildable from manifests, but avoid accidental data loss.
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

        // gsiAllPk is a constant "ALL" so this GSI lists every run newest-first.
        this.table.addGlobalSecondaryIndex({
            indexName: 'all-index',
            partitionKey: { name: 'gsiAllPk', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'executedAt', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });

        this.indexerFunction = new lambda.Function(this, 'ManifestIndexerFunction', {
            code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'manifest-indexer')),
            handler: 'index.handler',
            runtime: lambda.Runtime.PYTHON_3_13,
            timeout: cdk.Duration.seconds(30),
            environment: {
                TABLE_NAME: this.table.tableName,
            },
        });

        this.table.grantWriteData(this.indexerFunction);
        props.dataBucket.grantRead(this.indexerFunction, 'runs/*');

        props.dataBucket.addEventNotification(
            s3.EventType.OBJECT_CREATED,
            new s3notifications.LambdaDestination(this.indexerFunction),
            { prefix: 'runs/', suffix: 'manifest.json' },
        );
    }
}
