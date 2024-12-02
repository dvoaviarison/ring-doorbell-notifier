export function formatMessage(mainMessage, liveStreamUrl, recordingUrl) {
    const message = `${mainMessage}
- Live stream <${liveStreamUrl}|HERE>
- Motion recording <${recordingUrl}|HERE>`;
    return message;
}