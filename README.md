# Debt Clock

A detailed U.S. national debt tracker powered by the official [U.S. Treasury Debt to the Penny dataset](https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/).

## What it shows

- Latest official total public debt outstanding
- Optional live estimate based on the trailing 30-day change
- Daily, 30-day, and 12-month changes
- Debt per U.S. resident using the Census January 1, 2026 estimate
- Debt held by the public vs. intragovernmental holdings
- Interactive 30-day, 90-day, and one-year history
- Plain-language market context and transparent methodology

The official debt figure is published after each U.S. business day. The moving counter is clearly labeled as an estimate and can be turned off.

## Local development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Validation

```bash
npm run build
npm run lint
npm test
```

No API key is required. If the Fiscal Data API is unavailable, the server attempts the official TreasuryDirect summary page. If both official sources fail, the interface shows an unavailable state rather than a fabricated number.
