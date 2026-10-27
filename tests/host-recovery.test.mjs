import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rename, writeFile, unlink, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { startServer } from '../server.mjs';

const token = () => randomBytes(32).toString('base64url');
async function fixture(t) {
  const parent = await mkdtemp(join(tmpdir(), 'turnloom-recovery-'));
  const dataDir = join(parent, 'data');
  const app = await startServer({ port: 0, dataDir });
  t.after(async () => {
    await app.close();
    await rm(parent, { recursive: true, force: true });
  });
  const post = (path, body, credential) => fetch(app.url + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(credential ? { authorization: 'Bearer ' + credential } : {}),
    },
    body: JSON.stringify(body),
  });
  const session = credential => fetch(app.url + '/api/session', {
    headers: { authorization: 'Bearer ' + credential },
  });
  const response = await post('/api/demo', {});
  assert.equal(response.status, 201);
  const demo = await response.json();
  return { app, parent, dataDir, post, session, demo };
}

test('join survives a discarded response, replays exactly, and rejects another token', async t => {
  const f = await fixture(t);
  const invitation = f.demo.invitations[0].invitation;
  const sessionToken = token();
  const first = await f.post('/api/join', { invitation, sessionToken });
  assert.equal(first.status, 200);
  // Deliberately discard all response contents: recovery uses only the
  // credential the client retained before sending the request.
  await first.arrayBuffer();
  const recovered = await f.session(sessionToken);
  assert.equal(recovered.status, 200);
  const view = await recovered.json();
  assert.equal(view.actorId, f.demo.invitations[0].participantId);
  const replay = await f.post('/api/join', { invitation, sessionToken });
  assert.equal(replay.status, 200);
  const replayBody = await replay.json();
  assert.equal(replayBody.view.actorId, view.actorId);
  const rejected = await f.post('/api/join', {
    invitation, sessionToken: token(),
  });
  assert.equal(rejected.status, 401);
  await rejected.arrayBuffer();
  assert.equal((await f.session(sessionToken)).status, 200);
  const saved = await readFile(join(f.dataDir, 'estate.json'), 'utf8');
  assert.equal(saved.includes(sessionToken), false);
  assert.equal(saved.includes(invitation), false);
});

test('a token collision does not consume the second invitation', async t => {
  const f = await fixture(t);
  const firstInvite = f.demo.invitations[0];
  const secondInvite = f.demo.invitations[1];
  const reused = token();
  const first = await f.post('/api/join', {
    invitation: firstInvite.invitation, sessionToken: reused,
  });
  assert.equal(first.status, 200);
  await first.arrayBuffer();
  const collision = await f.post('/api/join', {
    invitation: secondInvite.invitation, sessionToken: reused,
  });
  assert.equal(collision.status, 409);
  assert.equal((await collision.json()).error.code, 'SESSION_COLLISION');
  const fresh = token();
  const retry = await f.post('/api/join', {
    invitation: secondInvite.invitation, sessionToken: fresh,
  });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).view.actorId, secondInvite.participantId);
  const originalSession = await f.session(reused);
  assert.equal((await originalSession.json()).actorId, firstInvite.participantId);
});

test('a genuine storage failure returns generic 500 and leaves committed state unchanged', async t => {
  const f = await fixture(t);
  const sessionToken = token();
  const joined = await f.post('/api/join', {
    invitation: f.demo.invitations[0].invitation, sessionToken,
  });
  assert.equal(joined.status, 200);
  const before = (await joined.json()).view;
  const moved = join(f.parent, 'saved-data');
  await rename(f.dataDir, moved);
  try {
    await writeFile(f.dataDir, 'a file where the directory was', { flag: 'wx' });
    const response = await f.post('/api/commands', {
      command: { type: 'topic.create', id: 'failed-topic', label: 'Must not commit' },
    }, sessionToken);
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.error.code, 'INTERNAL');
    assert.equal(JSON.stringify(body).includes(f.parent), false);
    assert.equal(JSON.stringify(body).includes('ENOTDIR'), false);
    assert.match(body.error.message, /could not be confirmed/i);
  } finally {
    await unlink(f.dataDir).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    await rename(moved, f.dataDir);
  }
  const afterResponse = await f.session(sessionToken);
  assert.equal(afterResponse.status, 200);
  assert.deepEqual(await afterResponse.json(), before);
  const retry = await f.post('/api/commands', {
    command: { type: 'topic.create', id: 'failed-topic', label: 'Now committed' },
  }, sessionToken);
  assert.equal(retry.status, 200);
  assert.ok((await retry.json()).view.topics.some(topic => topic.id === 'failed-topic'));
});
