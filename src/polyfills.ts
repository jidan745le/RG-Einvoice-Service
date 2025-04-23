// Polyfill for crypto in Node.js
import * as nodeCrypto from 'crypto';
 
// Make crypto available globally
(globalThis as any).crypto = {
  randomUUID: () => nodeCrypto.randomUUID()
}; 