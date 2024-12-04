import dotenv from 'dotenv';
import { run } from './app.mjs';

dotenv.config({ path: '.env' });
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