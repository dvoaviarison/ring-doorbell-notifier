import { logger } from "../logHelper/index.mjs";

export function sleep(ms) { 
    return new Promise(resolve => setTimeout(resolve, ms)); 
}

export function stopProcessInMs(timeMs){
    setTimeout(() => {
        logger.info('Stopping Service as per schedule...')
        process.exit(0);
    }, timeMs);
}