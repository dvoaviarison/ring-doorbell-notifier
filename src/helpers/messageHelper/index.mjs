export function formatMessage(mainMessage, recordingUrl) {
    const message = `@channel: ${mainMessage}: <${recordingUrl}|View recording>`;
    return message;
}