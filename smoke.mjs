import { StemClient, syntheticWorkflow, RESOURCE } from './stem-client.mjs';
import { authorize } from './oauth.mjs';

const args = process.argv.slice(2);
const live = args.length === 1 && args[0] === '--live-synthetic';
const fixture = args.length === 2 && args[0] === '--fixture';
if (!live && !fixture) {
  console.error('Usage: node smoke.mjs --fixture http://127.0.0.1:PORT/stem\n       node smoke.mjs --live-synthetic\nLive mode creates one OAuth client, asks you to sign in, saves only synthetic context, deletes that exact memory and attempts token revocation.');
  process.exitCode = 2;
} else {
  let grant; let client;
  try {
    const url = live ? RESOURCE : args[1];
    if (fixture && (new URL(url).protocol !== 'http:' || new URL(url).hostname !== '127.0.0.1')) throw new Error('Fixture mode accepts only an explicit HTTP 127.0.0.1 endpoint.');
    if (live) grant = await authorize({ onAuthorizationUrl: async authUrl => { console.log('Open this authorization URL in your browser. Select manual saving for this test connection.'); console.log(authUrl); } });
    client = new StemClient({ url, accessToken: grant?.accessToken, allowLocal: fixture });
    console.log(JSON.stringify({ ...await syntheticWorkflow(client), evidence: live ? 'live-authorized-synthetic-workflow' : 'local-transport-fixture-only', modelEvaluation: false }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Workflow failed.'); process.exitCode = 1;
  } finally {
    client?.forgetToken();
    if (grant) console.log(JSON.stringify({ oauthRevocationAcknowledged: await grant.revoke(), registrationMayRemain: true }));
  }
}
