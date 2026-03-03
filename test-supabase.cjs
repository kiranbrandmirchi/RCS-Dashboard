const { createClient } = require('@supabase/supabase-js');
const sb = createClient(
  'https://svdejhpmqybgwnbknjwz.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2ZGVqaHBtcXliZ3duYmtuand6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2NjIxODMsImV4cCI6MjA4NzIzODE4M30.rBOhC5VnD75hURgB8WiAD3VfjrtgCal6sKBwZeoVIzw'
);

async function test() {
  const tables = [
    'gads_customers',
    'gads_campaign_daily',
    'gads_adgroup_daily',
    'gads_campaign_status',
  ];
  for (const t of tables) {
    const { data, error } = await sb.from(t).select('*').limit(2);
    if (error) {
      console.log(t + ': ERROR - ' + error.message + (error.hint ? ' | hint: ' + error.hint : ''));
    } else {
      console.log(t + ': ' + data.length + ' rows' + (data.length > 0 ? ' | sample: ' + JSON.stringify(data[0]).substring(0, 300) : ' (empty)'));
    }
  }
  process.exit(0);
}

test().catch(e => { console.log('FATAL:', e.message); process.exit(1); });
