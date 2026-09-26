import {
  NODE_TYPES,
  CATEGORY_LABELS,
  CATEGORY_COLORS,
  CLOUD_SUBCATEGORY_ORDER,
  getNodeType,
} from './nodeRegistry';
import { globalIconRegistry } from './iconRegistry';

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures++;
    console.error(`  FAIL: ${message}`);
  }
}

console.log('=== 1. Testing Cloud Category & Labels ===');
{
  assert(CATEGORY_LABELS.cloud === 'Cloud', "CATEGORY_LABELS contains 'cloud'");
  assert(typeof CATEGORY_COLORS.cloud === 'string', "CATEGORY_COLORS contains 'cloud'");
  assert(
    CLOUD_SUBCATEGORY_ORDER.includes('AWS') &&
      CLOUD_SUBCATEGORY_ORDER.includes('Azure') &&
      CLOUD_SUBCATEGORY_ORDER.includes('GCP'),
    'CLOUD_SUBCATEGORY_ORDER includes AWS, Azure, GCP',
  );
}

console.log('\n=== 2. Testing Cloud Preset Nodes ===');
{
  const cloudNodes = NODE_TYPES.filter((n) => n.category === 'cloud');
  assert(
    cloudNodes.length >= 20,
    `At least 20 cloud preset nodes defined (found ${cloudNodes.length})`,
  );

  // AWS nodes
  const awsNodes = cloudNodes.filter((n) => n.subcategory === 'AWS');
  assert(awsNodes.length >= 6, `At least 6 AWS preset nodes defined (found ${awsNodes.length})`);
  assert(getNodeType('aws-lambda') !== undefined, 'AWS Lambda preset node exists');
  assert(getNodeType('aws-ec2') !== undefined, 'AWS EC2 preset node exists');
  assert(getNodeType('aws-s3') !== undefined, 'AWS S3 preset node exists');
  assert(getNodeType('aws-dynamodb') !== undefined, 'AWS DynamoDB preset node exists');

  // Azure nodes
  const azureNodes = cloudNodes.filter((n) => n.subcategory === 'Azure');
  assert(
    azureNodes.length >= 6,
    `At least 6 Azure preset nodes defined (found ${azureNodes.length})`,
  );
  assert(getNodeType('azure-functions') !== undefined, 'Azure Functions preset node exists');
  assert(getNodeType('azure-vm') !== undefined, 'Azure VM preset node exists');
  assert(getNodeType('azure-blob-storage') !== undefined, 'Azure Blob Storage preset node exists');
  assert(getNodeType('azure-cosmos-db') !== undefined, 'Azure Cosmos DB preset node exists');

  // GCP nodes
  const gcpNodes = cloudNodes.filter((n) => n.subcategory === 'GCP');
  assert(gcpNodes.length >= 6, `At least 6 GCP preset nodes defined (found ${gcpNodes.length})`);
  assert(getNodeType('gcp-cloud-functions') !== undefined, 'GCP Functions preset node exists');
  assert(getNodeType('gcp-compute-engine') !== undefined, 'GCP Compute Engine preset node exists');
  assert(getNodeType('gcp-cloud-storage') !== undefined, 'GCP Cloud Storage preset node exists');
  assert(getNodeType('gcp-firestore') !== undefined, 'GCP Firestore preset node exists');
}

console.log('\n=== 3. Testing Icon Resolvability for Preset Nodes ===');
{
  const cloudNodes = NODE_TYPES.filter((n) => n.category === 'cloud');
  for (const node of cloudNodes) {
    const iconDef = globalIconRegistry.getIcon(node.icon);
    assert(
      iconDef !== undefined,
      `Icon '${node.icon}' for preset node '${node.id}' resolves in icon registry`,
    );
  }
}

console.log('\n--------------------------------------------------');
if (failures === 0) {
  console.log('All nodeRegistry tests passed successfully!\n');
} else {
  throw new Error(`${failures} failure(s) in nodeRegistry tests.`);
}
