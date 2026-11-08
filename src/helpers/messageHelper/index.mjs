export function removeSlackChannelPrefix(message) {
    return typeof message === 'string'
        ? message.replace(/^\s*(?:@channel\b\s*:?\s*)+/i, '')
        : message;
}

export function formatMessage(mainMessage, recordingUrl) {
    const message = recordingUrl
        ? `@channel: ${mainMessage} <${recordingUrl}|View recording>`
        : `@channel: ${mainMessage}`;
    return message;
}