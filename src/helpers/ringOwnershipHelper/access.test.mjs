import { createRingAccessMiddleware } from './access.mjs';

async function check(membership, path, email = 'member@example.com', slackAuthenticated = false) {
  const req = { accountEmail: email, path, slackAuthenticated };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  const next = jest.fn();
  await createRingAccessMiddleware({ getMembership: async () => membership }, { error: jest.fn() })(req, res, next);
  return { req, res, next };
}

const group = { _id: '123', ownerEmail: 'owner@example.com', participants: ['owner@example.com', 'member@example.com'] };

test.each(['/settings/slack', '/settings/slack/secrets', '/auth/ring/login', '/auth/ring/mfa'])(
  'members cannot manage owner settings at %s', async path => {
    const { res, next } = await check(group, path);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  }
);

test('a former member cannot use their old Slack signing secret', async () => {
  const { res, next } = await check(null, '/capture', 'member@example.com', true);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(next).not.toHaveBeenCalled();
});

test.each(['/events', '/cameras', '/cameras/live', '/capture'])(
  'members use the owner connection for %s', async path => {
    const { req, next } = await check(group, path);
    expect(next).toHaveBeenCalled();
    expect(req.ringOwner).toBe('owner@example.com');
    expect(req.ringMembership._id).toBe('123');
  }
);

test('owners can configure Slack and issue signed Slack commands', async () => {
  expect((await check(group, '/settings/slack/secrets', 'owner@example.com')).next).toHaveBeenCalled();
  expect((await check(group, '/capture', 'owner@example.com', true)).next).toHaveBeenCalled();
});

test('release blocks account access while allowing its owner to retry', async () => {
  const releasing = { ...group, releasing: true };
  expect((await check(releasing, '/events')).res.status).toHaveBeenCalledWith(409);
  expect((await check(releasing, '/settings/ring-access/leave', 'owner@example.com')).next).toHaveBeenCalled();
});
