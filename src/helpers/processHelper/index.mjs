
export function sleep(ms) { 
    return new Promise(resolve => setTimeout(resolve, ms)); 
}

export function stopProcessInMs(timeMs){
    setTimeout(() => {
        console.log('Stopping Service as per schedule...')
        process.exit(0);
    }, timeMs);
}