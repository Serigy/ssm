import type { ReactNode } from 'react';
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
export declare function Table<T>({ columns, rows, rowKey, onRowClick, selectedKey, empty, className, }: TableProps<T>): import("react").JSX.Element;
export {};
//# sourceMappingURL=Table.d.ts.map