import path from 'path';

const pendingUploads = new Map();

export function trackPendingUpload(filePath) {
    const resolvedPath = path.resolve(filePath);
    pendingUploads.set(resolvedPath, (pendingUploads.get(resolvedPath) ?? 0) + 1);
    let tracked = true;

    return () => {
        if (!tracked) return;
        tracked = false;

        const remainingUploads = pendingUploads.get(resolvedPath) - 1;
        if (remainingUploads === 0) {
            pendingUploads.delete(resolvedPath);
        } else {
            pendingUploads.set(resolvedPath, remainingUploads);
        }
    };
}

export function isUploadPending(filePath) {
    return pendingUploads.has(path.resolve(filePath));
}
