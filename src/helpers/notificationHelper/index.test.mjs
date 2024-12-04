import { sendSlackNotificationWithSnapshot } from './index.mjs';

describe('sendSlackNotificationWithSnapshot', () => {
  it('should upload a file to Slack', async () => {
    // Arrange
    const message = '@channel: There is motion at your Front Door. : <http://google.com|View recording>';
    const snapShotFileName = 'snapshot.test.png';

    // Act
    var res = await sendSlackNotificationWithSnapshot(message, snapShotFileName);

    // Assert
    expect(res.ok).toBe(true);
  });
});
