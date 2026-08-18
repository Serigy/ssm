import type { ReactNode } from 'react';
import { cx } from '../utils/cx.js';

export interface Column<T> {
  key: string;
  header: string;
  /** Right-aligned tabular figures — use for money, counts and identifiers. */
  numeric?: boolean;
  width?: string;
  render: (row: T) => ReactNode;
}

interface TableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectedKey?: string;
  /** Rendered in place of the table when there are no rows. */
  empty?: ReactNode;
  className?: string;
}

/**
 * Generic over the row type so a column's `render` gets the real record, not
 * `any` — a mistyped field is then a compile error rather than "undefined" in
 * a cell.
 */
export function Table<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  selectedKey,
  empty,
  className,
}: TableProps<T>) {
  if (!rows.length && empty) return <>{empty}</>;

  return (
    // Wide tables scroll inside their own container; the page never scrolls sideways.
    <div className="ssm-table-scroll">
      <table className={cx('ssm-table', onRowClick && 'ssm-table--clickable', className)}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={c.width ? { width: c.width } : undefined} scope="col">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = rowKey(row);
            return (
              <tr
                key={key}
                aria-selected={selectedKey === key || undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
              >
                {columns.map((c) => (
                  <td key={c.key} className={c.numeric ? 'ssm-num' : undefined}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
