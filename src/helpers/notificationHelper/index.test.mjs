jest.mock('@slack/web-api', () => ({
  WebClient: jest.fn().mockImplementation(() => ({
    filesUploadV2: jest.fn().mockResolvedValue({ ok: true })
  }))
}));

import { WebClient } from '@slack/web-api';
import { sendSlackNotificationWithVideo } from './index.mjs';

describe('sendSlackNotificationWithVideo', () => {
  it('uploads the recorded video to Slack', async () => {
    const result = await sendSlackNotificationWithVideo('Motion detected', 'doorbell.mp4');

    expect(result).toEqual({ ok: true });
    expect(WebClient).toHaveBeenCalledWith(process.env.SLACK_BOT_TOKEN);
    expect(WebClient.mock.results[0].value.filesUploadV2).toHaveBeenCalledWith({
      channel_id: process.env.SLACK_CHANNEL_ID,
      initial_comment: 'Motion detected',
      file: `${process.env.APP_RECORDING_FOLDER}/doorbell.mp4`,
      filename: 'doorbell.mp4'
    });
  });
});
