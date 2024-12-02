import "dotenv/config";
import { RingApi } from 'ring-client-api';
import { readFile, writeFile } from "fs";
import { promisify } from "util";
import { getFormattedDateTime } from './helpers/dateHelper.js';
import { sendMkdSlackNotification } from './helpers/notificationHelper.js';
import { formatMessage } from './helpers/messageHelper.js';
import { uploadFileToDrive } from './helpers/uploadHelper.js'

const recordingDurationSec = 20;
const { env } = process;

const ringApi = new RingApi({
    refreshToken: env.RING_REFRESH_TOKEN,
});

// Keep token fresh
ringApi.onRefreshTokenUpdated.subscribe(
    async ({ newRefreshToken, oldRefreshToken }) => {
        console.log("Refresh Token Updated");
        if (!oldRefreshToken) {
            return;
        }

        const currentConfig = await promisify(readFile)(".env"),
            updatedConfig = currentConfig
                .toString()
                .replace(oldRefreshToken, newRefreshToken);

        await promisify(writeFile)(".env", updatedConfig);
    }
);

// Subscribe to all cameras' notifications
const locations = await ringApi.getLocations();
locations?.forEach(location => {
    location.cameras?.forEach(camera => {
        camera.onNewNotification.subscribe(async (notif) => {
            // Record Video
            const fileName = `${notif.data.device.name}-${getFormattedDateTime()}.mp4`;
            camera.recordToFile(`${env.APP_RECORDING_FOLDER}/${fileName}`, recordingDurationSec).then(async () => {
                // Upload Video
                var videoUrl = await uploadFileToDrive(fileName);

                // Send notification
                if (videoUrl) {
                    const liveUrl = `https://account.ring.com/account/dashboard?lv_d=${notif.data.device.id}`;
                    const message = formatMessage(
                        notif.android_config.body,
                        liveUrl,
                        videoUrl ? videoUrl : liveUrl
                    )
                    sendMkdSlackNotification(message);
                }
            });
        });
    });
});
