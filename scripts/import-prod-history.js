const WEBHOOK_URL = 'https://deployment-tracker-taupe.vercel.app/api/webhook';
const WEBHOOK_SECRET = '938d0036dc1c8b1d7588a542210560c88b9c6fdc57af47f15600630f12fc2a25';

// Ankura Production deployments
const ankuraDeployments = [
  { id: '30626212501', status: 'cancelled', date: '2026-07-31T11:12:28Z', title: 'Prod Full Deploy: Cluster [vidai-prod] Deploy type: frontend Tag: release_pre_prod_2.0.0 Frontend Branch: release/pre_prod_2.0.0' },
  { id: '30272588441', status: 'failure', date: '2026-07-27T13:55:39Z', title: 'Prod Full Deploy: Cluster [vidai-prod] Deploy type: backend Tag: release_prod_ankura_0.0.2 Frontend Branch: release/prod/ankura/0.0.2' },
  { id: '30268704146', status: 'success', date: '2026-07-27T13:05:56Z', title: 'Prod Full Deploy: Cluster [vidai-prod] Deploy type: frontend Tag: release_prod_1.0.0 Frontend Branch: release/prod_1.0.0' },
  { id: '29930587758', status: 'success', date: '2026-07-22T14:51:18Z', title: 'Prod Full Deploy: Cluster [vidai-prod] Deploy type: backend Tag: release_prod_ankura_0.0.2 Frontend Branch: release/prod/ankura/0.0.2' },
  { id: '29930494168', status: 'success', date: '2026-07-22T14:50:09Z', title: 'Prod Full Deploy: Cluster [vidai-prod] Deploy type: frontend Tag: release_pre_prod_2.0.0 Frontend Branch: release/pre_prod_2.0.0' },
  { id: '29419384055', status: 'success', date: '2026-07-15T13:29:23Z', title: 'Prod Full Deploy: Cluster [vidai-prod] Deploy type: backend Tag: release_prod_ankura_0.0.1 Frontend Branch: main' },
  { id: '29418420449', status: 'success', date: '2026-07-15T13:15:18Z', title: 'Prod Full Deploy: Cluster [vidai-prod] Deploy type: frontend Tag: release_prod_1.0.0 Frontend Branch: release/prod_1.0.0' },
  { id: '29036835200', status: 'success', date: '2026-07-09T17:22:53Z', title: 'Prod Full Deploy: Cluster [vidai-prod] Deploy type: frontend Tag: release_prod_1.0.0 Frontend Branch: release/prod_1.0.0' },
  { id: '29020108901', status: 'failure', date: '2026-07-09T13:04:17Z', title: 'Prod Full Deploy: Cluster [vidai-prod] Deploy type: frontend Tag: release_prod_1.0.0 Frontend Branch: release/prod_1.0.0' },
  { id: '28990536482', status: 'success', date: '2026-07-09T02:49:26Z', title: 'Prod Full Deploy: Cluster [vidai-prod] Deploy type: frontend Tag: release_prod_1.0.0 Frontend Branch: release/prod_1.0.0' },
  { id: '28969364148', status: 'cancelled', date: '2026-07-08T19:20:02Z', title: 'Prod Full Deploy: Cluster [vidai-prod] Deploy type: frontend Tag: release_prod_1.0.0 Frontend Branch: release/prod_1.0.0' },
  { id: '28956507519', status: 'success', date: '2026-07-08T15:54:56Z', title: 'Prod Full Deploy: Cluster [vidai-prod] Deploy type: backend Tag: release_prod_ankura_0.0.1 Frontend Branch: main' },
  { id: '28956157824', status: 'success', date: '2026-07-08T15:49:50Z', title: 'Prod Full Deploy: Cluster [vidai-prod] Deploy type: frontend Tag: release_prod_1.0.0 Frontend Branch: release/prod_1.0.0' },
  { id: '28694606119', status: 'success', date: '2026-07-04T04:15:13Z', title: 'Prod Full Deploy: Cluster [vidai-prod] Deploy type: frontend Tag:  Frontend Branch: release/ank_prod_0.0.9' },
  { id: '28443354500', status: 'success', date: '2026-06-30T12:12:32Z', title: 'Prod Full Deploy: Cluster [vidai-prod] Deploy type: backend Tag: release_prod_0.0.2 Frontend Branch: main' },
  { id: '28442864947', status: 'success', date: '2026-06-30T12:03:50Z', title: 'Prod Full Deploy: Cluster [vidai-prod] Deploy type: frontend Tag: release_ank_prod_0.0.9 Frontend Branch: release/ank_prod_0.0.9' },
  { id: '27417078332', status: 'success', date: '2026-06-12T12:57:04Z', title: 'Prod Full Deploy: Cluster [vidai-prod] Deploy type: frontend Tag: release_ank_prod_0.0.9 Frontend Branch: release/ank_prod_0.0.9' },
  { id: '26338774696', status: 'success', date: '2026-05-23T17:15:21Z', title: 'Prod Full Deploy: Cluster [vidai-prod] Deploy type: backend Tag: release_prod_0.0.2 Frontend Branch: main' },
  { id: '26338723391', status: 'success', date: '2026-05-23T17:12:49Z', title: 'Prod Full Deploy: Cluster [vidai-prod] Deploy type: frontend Tag: release_ank_prod_0.0.8 Frontend Branch: release/ank_prod_0.0.8' },
  { id: '25535388338', status: 'success', date: '2026-05-08T03:41:45Z', title: 'Prod Full Deploy: Cluster [vidai-prod] Deploy type: backend Tag: release_prod_0.0.1 Frontend Branch: release/prod_0.0.1' },
];

// Neotia/Babyjoy Production deployments
const neotiaDeployments = [
  { id: '32510936705', status: 'success', date: '2026-08-21T17:58:32Z', title: 'Prod Full Deploy: Cluster [production-aps-ecs-cluster] Deploy type: backend Tag: release_prod_neotia_0.0.2 Frontend Branch: release/prod/neotia/0.0.2' },
  { id: '32278839419', status: 'success', date: '2026-08-19T16:57:10Z', title: 'Prod Full Deploy: Cluster [production-aps-ecs-cluster] Deploy type: frontend Tag: release_pre_prod_3.0.0 Frontend Branch: release/pre_prod_3.0.0' },
  { id: '32275687621', status: 'success', date: '2026-08-19T16:24:04Z', title: 'Prod Full Deploy: Cluster [production-aps-ecs-cluster] Deploy type: backend Tag: release_prod_neotia_0.0.2 Frontend Branch: release/prod/neotia/0.0.2' },
  { id: '31665508103', status: 'cancelled', date: '2026-08-13T03:57:57Z', title: 'Prod Full Deploy: Cluster [production-aps-ecs-cluster] Deploy type: backend Tag: release_prod_neotia_0.0.2 Frontend Branch: release/prod/neotia_0.0.2' },
  { id: '31514204718', status: 'success', date: '2026-08-11T16:46:57Z', title: 'Prod Full Deploy: Cluster [production-aps-ecs-cluster] Deploy type: frontend Tag: feature_babyjoy_release_2.0.0 Frontend Branch: feature/babyjoy_release_2.0.0' },
  { id: '31503515176', status: 'failure', date: '2026-08-11T14:47:53Z', title: 'Prod Full Deploy: Cluster [production-aps-ecs-cluster] Deploy type: backend Tag: release_prod_neotia_0.0.2 Frontend Branch: release/prod/neotia_0.0.2' },
  { id: '31499683130', status: 'failure', date: '2026-08-11T14:05:43Z', title: 'Prod Full Deploy: Cluster [production-aps-ecs-cluster] Deploy type: backend Tag: release_prod_neotia_0.0.2 Frontend Branch: release/prod/neotia_0.0.2' },
  { id: '31107854091', status: 'failure', date: '2026-08-06T13:50:39Z', title: 'Prod Full Deploy: Cluster [production-aps-ecs-cluster] Deploy type: backend Tag: release_prod_neotia_0.0.1 Frontend Branch: release/prod/neotia/0.0.1' },
  { id: '30746771255', status: 'success', date: '2026-08-02T11:56:26Z', title: 'Prod Full Deploy: Cluster [production-aps-ecs-cluster] Deploy type: backend Tag: release_prod_neotia_0.0.1 Frontend Branch: release/prod/neotia/0.0.1' },
  { id: '30746385716', status: 'failure', date: '2026-08-02T11:45:14Z', title: 'Prod Full Deploy: Cluster [production-aps-ecs-cluster] Deploy type: backend Tag: release_prod_neotia_0.0.1 Frontend Branch: release/prod/neotia/0.0.1' },
  { id: '30746244775', status: 'failure', date: '2026-08-02T11:41:02Z', title: 'Prod Full Deploy: Cluster [production-aps-ecs-cluster] Deploy type: backend Tag: release_prod_neotia_0.0.1 Frontend Branch:  release/prod/neotia/0.0.1' },
  { id: '30745989107', status: 'success', date: '2026-08-02T11:33:31Z', title: 'Prod Full Deploy: Cluster [production-aps-ecs-cluster] Deploy type: frontend Tag: release_pre_prod_2.0.0 Frontend Branch: release/pre_prod_2.0.0 ' },
  { id: '30272745738', status: 'success', date: '2026-07-27T13:57:37Z', title: 'Prod Full Deploy: Cluster [production-aps-ecs-cluster] Deploy type: backend Tag: release_prod_neotia_0.0.1 Frontend Branch: release/prod/neotia/0.0.1' },
  { id: '30013499546', status: 'success', date: '2026-07-23T13:56:49Z', title: 'Prod Full Deploy: Cluster [production-aps-ecs-cluster] Deploy type: backend Tag: release_prod_neotia_0.0.1 Frontend Branch: release/prod/neotia/0.0.1' },
  { id: '30007706566', status: 'success', date: '2026-07-23T12:37:10Z', title: 'Prod Full Deploy: Cluster [production-aps-ecs-cluster] Deploy type: frontend Tag: release_pre_prod_2.0.0 Frontend Branch: release/pre_prod_2.0.0' },
  { id: '29936305884', status: 'success', date: '2026-07-22T16:03:59Z', title: 'Prod Full Deploy: Cluster [production-aps-ecs-cluster] Deploy type: backend Tag: release_prod_neotia_0.0.1 Frontend Branch: release/prod/neotia/0.0.1' },
  { id: '29930747295', status: 'success', date: '2026-07-22T14:53:18Z', title: 'Prod Full Deploy: Cluster [production-aps-ecs-cluster] Deploy type: backend Tag: release_prod_neotia_0.0.1 Frontend Branch: release/prod/neotia/0.0.1' },
  { id: '29847511683', status: 'success', date: '2026-07-21T16:12:00Z', title: 'Prod Full Deploy: Cluster [production-aps-ecs-cluster] Deploy type: backend Tag: release_prod_neotia_0.0.1 Frontend Branch: release/prod/neotia/0.0.1' },
  { id: '29836452855', status: 'failure', date: '2026-07-21T13:52:35Z', title: 'Prod Full Deploy: Cluster [production-aps-ecs-cluster] Deploy type: backend Tag: release_prod_neotia_0.0.1 Frontend Branch: main' },
  { id: '29835581169', status: 'success', date: '2026-07-21T13:41:21Z', title: 'Prod Full Deploy: Cluster [production-aps-ecs-cluster] Deploy type: frontend Tag: release_pre_prod_2.0.0 Frontend Branch: release/pre_prod_2.0.0' },
];

function parseDeployment(deployment) {
  const titleMatch = deployment.title.match(/Deploy type: (\w+) Tag: ([^\s]*) Frontend Branch: (.+)$/);
  const deployType = titleMatch ? titleMatch[1] : 'unknown';
  const tag = titleMatch ? titleMatch[2].trim() : '';
  const branch = titleMatch ? titleMatch[3].trim() : '';
  
  const status = deployment.status === 'success' ? 'Success' : 
                 deployment.status === 'failure' ? 'Failed' : 
                 deployment.status === 'cancelled' ? 'Cancelled' : 'Failed';
  
  return {
    deployType,
    tag,
    branch,
    status
  };
}

async function importDeployment(deployment, environment) {
  const parsed = parseDeployment(deployment);
  
  const payload = {
    environment,
    status: parsed.status,
    deployment_type: 'standard',
    branch: parsed.branch,
    version: parsed.tag,
    requested_by: 'vidai-devops',
    deployed_by: 'GitHub Actions',
    ticket_link: `https://github.com/vidaisolutions/vidai-devops/actions/runs/${deployment.id}`,
    notes: `Historical import | Deploy type: ${parsed.deployType}`,
    started_at: deployment.date,
  };

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${WEBHOOK_SECRET}`
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (response.ok) {
      console.log(`✅ ${environment} | ${deployment.id} | ${parsed.status} | ${parsed.branch}`);
      return true;
    } else {
      console.error(`❌ ${environment} | ${deployment.id} | Error:`, result);
      return false;
    }
  } catch (error) {
    console.error(`❌ ${environment} | ${deployment.id} | Error:`, error.message);
    return false;
  }
}

async function main() {
  console.log('Starting import of production deployment history...\n');
  
  let successCount = 0;
  let failCount = 0;

  console.log('=== Importing Ankura Production deployments ===');
  for (const deployment of ankuraDeployments) {
    const success = await importDeployment(deployment, 'Production (Ankura)');
    if (success) successCount++;
    else failCount++;
    await new Promise(resolve => setTimeout(resolve, 100)); // Rate limiting
  }

  console.log('\n=== Importing Neotia/Babyjoy Production deployments ===');
  for (const deployment of neotiaDeployments) {
    const success = await importDeployment(deployment, 'Production (Neotia/Babyjoy)');
    if (success) successCount++;
    else failCount++;
    await new Promise(resolve => setTimeout(resolve, 100)); // Rate limiting
  }

  console.log('\n=== Import Complete ===');
  console.log(`✅ Successfully imported: ${successCount}`);
  console.log(`❌ Failed: ${failCount}`);
  console.log(`📊 Total: ${successCount + failCount}`);
}

main();
