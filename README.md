# Debt Clock

A detailed U.S. national debt tracker powered by the official [U.S. Treasury Debt to the Penny dataset](https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/).

## What it shows

- Latest official total public debt outstanding
- Optional live estimate based on the trailing 30-day change
- Daily, 30-day, and 12-month changes
- Debt per U.S. resident using the Census January 1, 2026 estimate
- Debt held by the public vs. intragovernmental holdings
- Top 10 foreign holders from the monthly Treasury TIC table, with country flags, exact USD values, trillion-equivalent values, and month-over-month changes
- Latest official 10-year TIPS real yield plus the 5Y–30Y real yield curve
- Interactive 30-day, 90-day, and one-year history with pointer, touch, and keyboard inspection
- Plain-language market context and transparent methodology

The official debt figure and TIPS real yields are published after U.S. business days. Foreign-holder data is monthly and published with a reporting lag. The moving debt counter is clearly labeled as an estimate and can be turned off.

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

Country flag assets are sourced from [FlagCDN](https://flagcdn.com/). The Debt//Clock Treasury-column logo is an original generated asset for this project.
