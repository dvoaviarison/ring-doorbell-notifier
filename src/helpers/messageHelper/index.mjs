export function formatMessage(mainMessage, recordingUrl, cameraName) {
    const cameraLink = cameraName ? `<ring://|${cameraName}> ` : '';
    const message = recordingUrl
        ? `@channel: ${cameraLink}${mainMessage} <${recordingUrl}|View recording>`
        : `@channel: ${cameraLink}${mainMessage}`;
    return message;
}