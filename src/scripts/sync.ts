import 'dotenv/config';
import { syncAll } from '../shopify/sync.js';

const opts = {
  ordersOnly: process.argv.includes('--orders'),
  syncShiprocket: process.argv.includes('--shiprocket'),
  skipShiprocket: process.argv.includes('--no-shiprocket'),
};

async function main() {
  const started = Date.now();
  if (opts.ordersOnly) {
    const { syncOrders } = await import('../shopify/sync.js');
    await syncOrders({ syncShipment: !opts.skipShiprocket && opts.syncShiprocket });
    if (opts.syncShiprocket) {
      const { syncShiprocketOrders } = await import('../shiprocket/client.js');
      await syncShiprocketOrders();
    }
  } else {
    await syncAll({ sync: !opts.skipShiprocket });
  }
  console.log(`total sync took ${((Date.now() - started) / 1000).toFixed(1)}s`);
  process.exit(0);
}

main().catch(async (e) => {
  console.error('sync failed:', e.message);
  process.exit(1);
});