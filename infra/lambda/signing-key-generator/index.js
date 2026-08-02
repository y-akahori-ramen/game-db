'use strict';

const crypto = require('node:crypto');
const { SecretsManagerClient, GetSecretValueCommand, PutSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const secretsManager = new SecretsManagerClient({});

exports.onEvent = async (event) => {
  const requestType = event.RequestType;
  const secretArn = event.ResourceProperties.SecretArn;
  const physicalResourceId = event.PhysicalResourceId ?? secretArn;

  if (requestType === 'Create') {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem',
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem',
      },
    });

    await secretsManager.send(
      new PutSecretValueCommand({
        SecretId: secretArn,
        SecretString: JSON.stringify({
          privateKeyPem: privateKey,
          publicKeyPem: publicKey,
        }),
      }),
    );

    return {
      PhysicalResourceId: physicalResourceId,
      Data: {
        PublicKeyPem: publicKey,
      },
    };
  }

  if (requestType === 'Update') {
    // Keep the existing key pair on stack updates so active signed cookies are not invalidated.
    const response = await secretsManager.send(
      new GetSecretValueCommand({
        SecretId: secretArn,
      }),
    );

    const secretString = response.SecretString;
    if (!secretString) {
      throw new Error(`Secret ${secretArn} does not contain a string value.`);
    }

    const secretValue = JSON.parse(secretString);
    if (typeof secretValue.publicKeyPem !== 'string') {
      throw new Error(`Secret ${secretArn} does not contain publicKeyPem.`);
    }

    return {
      PhysicalResourceId: physicalResourceId,
      Data: {
        PublicKeyPem: secretValue.publicKeyPem,
      },
    };
  }

  // Intentionally retain the key pair on delete to avoid breaking active signed cookies during stack teardown/redeploy workflows.
  return {
    PhysicalResourceId: physicalResourceId,
  };
};
