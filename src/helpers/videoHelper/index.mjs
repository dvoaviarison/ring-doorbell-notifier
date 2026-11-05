import "dotenv/config";

const { env } = process;

export async function recordVideoFromCamera(camera, videoFileName, recordingDurationSec) {
    return await camera.recordToFile(
        `${env.APP_RECORDING_FOLDER}/${videoFileName}`,
        recordingDurationSec
    );
}