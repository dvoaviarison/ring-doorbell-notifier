jest.mock('@slack/web-api', () => ({
  WebClient: jest.fn().mockImplementation(() => ({
    filesUploadV2: jest.fn().mockResolvedValue({ ok: true })
  }))
}));

import { WebClient } from '@slack/web-api';
import { sendSlackNotificationWithVideo } from './index.mjs';

describe('sendSlackNotificationWithVideo', () => {
  it('uploads the recorded video to Slack', async () => {
    const result = await sendSlackNotificationWithVideo('Motion detected', 'doorbell.mp4', {
      botToken: 'account-token',
      channelId: 'account-channel'
    });

    expect(result).toEqual({ ok: true });
    expect(WebClient).toHaveBeenCalledWith('account-token');
    expect(WebClient.mock.results[0].value.filesUploadV2).toHaveBeenCalledWith({
      channel_id: 'account-channel',
      initial_comment: 'Motion detected',
      file: `${process.env.APP_RECORDING_FOLDER}/doorbell.mp4`,
      filename: 'doorbell.mp4'
    });
  });

  it('does not use global settings when account settings are absent', async () => {
    WebClient.mockClear();
    await expect(sendSlackNotificationWithVideo('Motion detected', 'doorbell.mp4')).resolves.toBeNull();
    expect(WebClient).not.toHaveBeenCalled();
  });
});
