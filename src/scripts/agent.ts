import 'dotenv/config';
import { pool } from '../db/pool.js';
import { answerText } from '../agent/agent.js';

/** CLI test for the agent: `npm run agent "price of the mini dholki clutch"` */
async function main() {
  const text = process.argv.slice(2).join(' ');
  if (!text) {
    console.log('usage: npm run agent "your message"');
    process.exit(1);
  }
  const reply = await answerText(text);
  console.log('\n>>>', text, '\n\n<<<', reply);
  await pool.end();
}

main().catch(async (e) => {
  console.error(e.message);
  await pool.end().catch(() => {});
  process.exit(1);
});