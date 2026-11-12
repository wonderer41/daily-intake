import type { CSSProperties } from "react";
import { Eyebrow } from "@/components/ui/typography";
import type { StocksSnapshot } from "@/types/dashboard-contracts";
import { balancedColumns, formatChange, formatPrice, sameCurrency } from "./format";

const MAX_ROWS = 12;

type StocksRow = StocksSnapshot["rows"][number];

/**
 * Column counts, widest first. Every one is rendered and banner.css shows the one whose 280px columns
 * fit the slide (a container query), so the layout is right from the first paint without measuring.
 */
const LAYOUTS = [4, 3, 2, 1] as const;

function Change({ pct }: { pct: number | null }) {
  if (pct === null) {
    return (
      <td className="banner-change banner-change--flat">
        <span aria-hidden="true">—</span>
        <span className="sr-only">no data yet</span>
      </td>
    );
  }
  const change = formatChange(pct);
  return (
    <td className={`banner-change banner-change--${change.direction}`}>
      <span aria-hidden="true">{change.text}</span>
      <span className="sr-only">{change.spoken}</span>
    </td>
  );
}

export interface StocksSlideProps {
  data: StocksSnapshot;
}

/** Slide 4: Symbol · Price · Day · 6M. Up = ▲ +x.x% (green), down = ▼ −x.x% (red); the sign and arrow carry the meaning. */
export function StocksSlide({ data }: StocksSlideProps) {
  const rows = data.rows.slice(0, MAX_ROWS);
  const omitted = data.rows.length - rows.length;
  // One currency for every row is stated once in the header; mixed currencies are tagged per row.
  const currency = sameCurrency(rows);

  return (
    <>
      <div className="banner-split-head">
        <Eyebrow>Stocks</Eyebrow>
        <p className="banner-meta">
          {currency ? `prices in ${currency} · day · 6 months` : "price · day · 6 months"}
          {omitted > 0 ? ` · +${omitted} not shown` : ""}
        </p>
      </div>
      <div className="banner-stocks">
        {LAYOUTS.map((layout) => (
          <StocksGrid key={layout} layout={layout} rows={rows} currency={currency} />
        ))}
      </div>
    </>
  );
}

interface StocksGridProps {
  layout: (typeof LAYOUTS)[number];
  rows: StocksRow[];
  /** The shared currency, or null when rows mix currencies (then each row is tagged). */
  currency: string | null;
}

/**
 * One layout: `layout` columns of equal length, filled top to bottom. Each table fills the slide's
 * height and its rows share the extra space; a shorter last column is sized so its rows line up.
 */
function StocksGrid({ layout, rows, currency }: StocksGridProps) {
  const columns = balancedColumns(rows, layout);
  const perColumn = columns[0]?.length ?? 0;
  return (
    <div className="banner-stocks__grid" data-layout={layout}>
      {columns.map((column, columnIndex) => {
        const first = columnIndex * perColumn + 1;
        const style: CSSProperties | undefined =
          column.length < perColumn
            ? { height: `calc((100% - var(--stocks-head)) * ${column.length} / ${perColumn} + var(--stocks-head))` }
            : undefined;
        return (
          <table
            key={columnIndex}
            className="banner-stocks__table"
            style={style}
            aria-label={`Stocks ${first} to ${first + column.length - 1} of ${rows.length}`}
          >
            <thead>
              <tr>
                <th scope="col" className="banner-stocks__symbol">
                  Symbol
                </th>
                <th scope="col">Price</th>
                <th scope="col">
                  Day<span className="sr-only"> change</span>
                </th>
                <th scope="col">
                  6M<span className="sr-only"> change, six months</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {column.map((row) => (
                <tr key={row.symbol}>
                  <th scope="row" className="banner-stocks__symbol" title={row.symbol}>
                    {row.symbol}
                    {currency ? null : <span className="banner-stocks__currency">{row.currency}</span>}
                  </th>
                  <td className="banner-stocks__price">{formatPrice(row.price)}</td>
                  <Change pct={row.dayChangePct} />
                  <Change pct={row.sixMonthChangePct} />
                </tr>
              ))}
            </tbody>
          </table>
        );
      })}
    </div>
  );
}
