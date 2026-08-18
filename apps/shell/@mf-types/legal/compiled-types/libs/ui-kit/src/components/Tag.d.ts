import type { HTMLAttributes, ReactNode } from 'react';
interface TagProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'onClick'> {
    selected?: boolean;
    onRemove?: () => void;
    onClick?: () => void;
    children: ReactNode;
}
export declare function Tag({ selected, onRemove, onClick, className, children, ...rest }: TagProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=Tag.d.ts.map