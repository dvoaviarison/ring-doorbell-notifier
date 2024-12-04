import "dotenv/config";
import ffmpeg from 'fluent-ffmpeg';

const { env } = process;

export async function takeSnapshotFromVideo(videoFileName, timeSecond, snapshotFileName) {  
    const videoFilePath = `${env.APP_RECORDING_FOLDER}/${videoFileName}`;
    const res = await new Promise((resolve) => {
        ffmpeg(videoFilePath)
            .screenshots({
                timestamps: [timeSecond],
                filename: snapshotFileName,
                folder: env.APP_RECORDING_FOLDER
            })
            .on('end', () => {
                resolve(true);
            })
            .on('error', (err) => {
                console.log(err);
                resolve(false);
            });
    });

    return res;
}

export async function recordVideoFromCamera(camera, videoFileName, recordingDurationSec) {
    return await camera.recordToFile(`${env.APP_RECORDING_FOLDER}/${videoFileName}`, recordingDurationSec);
}