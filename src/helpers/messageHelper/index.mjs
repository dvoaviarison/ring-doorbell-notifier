export function formatMessage(mainMessage, recordingUrl) {
    const message = recordingUrl
        ? `@channel: ${mainMessage} <${recordingUrl}|View recording>`
        : `@channel: ${mainMessage}`;
    return message;
}