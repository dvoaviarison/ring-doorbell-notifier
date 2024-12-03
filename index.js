import { run } from './notifier.js';

const runWithExceptionRecovery = async () => {
    try {
        await run();
    } catch (error) {
      console.error('Error caught:', error.message);
      console.log('Restarting...');
      await new Promise(res => setTimeout(res, 1000)); // Wait 1 second before restarting
      runWithExceptionRecovery(); // Restart the function
    }
  };
  
  // Start the main function
  runWithExceptionRecovery();