import path from 'path';
import { isUploadPending, trackPendingUpload } from './index.mjs';

describe('pending upload tracking', () => {
    it('keeps a recording marked as pending until all uploads finish', () => {
        const filePath = path.join('recordings', 'motion.mp4');
        const stopFirstUpload = trackPendingUpload(filePath);
        const stopSecondUpload = trackPendingUpload(filePath);

        expect(isUploadPending(path.resolve(filePath))).toBe(true);

        stopFirstUpload();
        expect(isUploadPending(filePath)).toBe(true);

        stopSecondUpload();
        expect(isUploadPending(filePath)).toBe(false);
    });
});
