/* eslint-disable no-console */
const expiryFormats = [
  '2026-02-28',
  '28-02-2026',
  '20260228',
  '26FEB2026',
  '26 Feb 2026',
  '26-Feb-2026',
  '26/02/2026',
  '2026/02/26',
  '26-Feb-26',
  'FEB2026',
  '2026FEB',
];

const patterns = [
  (u) => `https://priceapi.moneycontrol.com/pricefeed/mcx/commodityspot/${u}`,
  (u) => `https://priceapi.moneycontrol.com/pricefeed/mcx/commodityspot/${u}?expiry=2026-02-28`,
  (u) => `https://priceapi.moneycontrol.com/pricefeed/mcx/commodityspot/${u}?date=2026-02-28`,
  (u) => `https://priceapi.moneycontrol.com/pricefeed/mcx/commodityfuture/${u}`,
  (u) => `https://priceapi.moneycontrol.com/pricefeed/mcx/commodityfuture/${u}/2026-02-28`,
  (u) => `https://priceapi.moneycontrol.com/pricefeed/mcx/commodityfuture/${u}/28-02-2026`,
  (u) => `https://priceapi.moneycontrol.com/pricefeed/mcx/commodityfuture/${u}/20260228`,
  (u) => `https://priceapi.moneycontrol.com/pricefeed/mcx/commodityfuture/${u}/26FEB2026`,
  ...expiryFormats.flatMap((exp) => [
    (u) => `https://priceapi.moneycontrol.com/pricefeed/mcx/commodityfuture/${u}?expiry=${encodeURIComponent(exp)}`,
    (u) => `https://priceapi.moneycontrol.com/pricefeed/mcx/commodityfuture/${u}?expdate=${encodeURIComponent(exp)}`,
    (u) => `https://priceapi.moneycontrol.com/pricefeed/mcx/commodityfuture/${u}?expirydate=${encodeURIComponent(exp)}`,
    (u) => `https://priceapi.moneycontrol.com/pricefeed/mcx/commodityfuture/${u}?ExpiryDate=${encodeURIComponent(exp)}`,
  ]),
];

const items = ['gold', 'silver', 'copper', 'crudeoil'];

(async () => {
  for (const item of items) {
    let found = false;
    for (const fn of patterns) {
      const url = fn(item);
      try {
        const r = await fetch(url, {
          headers: {
            'user-agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            accept: 'application/json',
          },
        });
        const t = await r.text();
        const json = (() => {
          try {
            return JSON.parse(t);
          } catch {
            return null;
          }
        })();
        const ok = r.status === 200 && json && json.code === '200' && json.data;
        if (ok) {
          console.log('\nFOUND', item, url);
          console.log(JSON.stringify(json).slice(0, 260).replace(/\s+/g, ' '));
          found = true;
          break;
        }
      } catch (e) {
        // ignore
      }
    }
    if (!found) console.log('\nNO MATCH', item);
  }
})();
