import * as cdk from 'aws-cdk-lib';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import { BLOCKED_IPS } from './blocked-ips';

export interface EdgeStackProps extends cdk.StackProps {}

export class EdgeStack extends cdk.Stack {
  public readonly ipSet: wafv2.CfnIPSet;
  public readonly webAclArn!: string;

  constructor(scope: Construct, id: string, props: EdgeStackProps) {
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
  }
}
