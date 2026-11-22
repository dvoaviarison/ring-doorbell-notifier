import "dotenv/config";
import { firstValueFrom } from 'rxjs';

const { env } = process;

export async function recordVideoFromCamera(camera, videoFileName, recordingDurationSec) {
    const liveCall = await camera.streamVideo({
        input: ['-reorder_queue_size', '1024', '-buffer_size', '4194304'],
        output: ['-t', recordingDurationSec.toString(), `${env.APP_RECORDING_FOLDER}/${videoFileName}`]
    });
    await firstValueFrom(liveCall.onCallEnded);
}