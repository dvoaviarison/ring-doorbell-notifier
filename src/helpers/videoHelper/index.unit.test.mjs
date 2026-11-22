import { recordVideoFromCamera } from './index.mjs';
import { ReplaySubject, Subject } from 'rxjs';

describe('recordVideoFromCamera', () => {
    beforeEach(() => {
        process.env.APP_RECORDING_FOLDER = '/recordings';
    });

    it('records a video to the requested file for the requested duration', async () => {
        const onCallEnded = new Subject();
        const camera = {
            streamVideo: jest.fn().mockResolvedValue({ onCallEnded })
        };
        const recording = recordVideoFromCamera(camera, 'doorbell.mp4', 10);
        await Promise.resolve();

        expect(camera.streamVideo).toHaveBeenCalledWith({
            input: ['-reorder_queue_size', '1024', '-buffer_size', '4194304'],
            output: ['-t', '10', '/recordings/doorbell.mp4']
        });
        expect(onCallEnded.observed).toBe(true);

        onCallEnded.next();
        await expect(recording).resolves.toBeUndefined();
        expect(onCallEnded.observed).toBe(false);
    });

    it('handles a stream that ends before the recording starts waiting', async () => {
        const onCallEnded = new ReplaySubject(1);
        onCallEnded.next();
        const camera = {
            streamVideo: jest.fn().mockResolvedValue({ onCallEnded })
        };

        await expect(recordVideoFromCamera(camera, 'doorbell.mp4', 10))
            .resolves.toBeUndefined();
    });

    it('rejects when recording fails', async () => {
        const error = new Error('Recording failed');
        const camera = {
            streamVideo: jest.fn().mockRejectedValue(error)
        };

        await expect(recordVideoFromCamera(camera, 'doorbell.mp4', 10))
            .rejects.toBe(error);
    });

    it('rejects if the streaming session reports an error', async () => {
        const onCallEnded = new Subject();
        const error = new Error('Streaming failed');
        const camera = {
            streamVideo: jest.fn().mockResolvedValue({ onCallEnded })
        };
        const recording = recordVideoFromCamera(camera, 'doorbell.mp4', 10);
        await Promise.resolve();

        onCallEnded.error(error);
        await expect(recording).rejects.toBe(error);
    });
});
