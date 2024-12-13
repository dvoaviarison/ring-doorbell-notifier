import { sendSlackNotificationWithSnapshot } from './index.mjs';
import { getAIPoweredSnapshotDescription } from '../aiHelper/index.mjs';

describe('sendSlackNotificationWithSnapshot', () => {
  it('should upload a file to Slack', async () => {
    // Arrange
    const snapShotFileName = 'snapshot.test.png';
    var description = await getAIPoweredSnapshotDescription(snapShotFileName, 'Front Door');
    const message = `@channel: ${description} <http://google.com|View recording>`;

    // Act
    var res = await sendSlackNotificationWithSnapshot(message, snapShotFileName);

    // Assert
    expect(res.ok).toBe(true);
  });
});
