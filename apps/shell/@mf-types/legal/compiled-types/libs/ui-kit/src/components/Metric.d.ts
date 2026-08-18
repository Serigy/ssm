interface MetricProps {
    label: string;
    value: string;
    delta?: string;
    tone?: 'neutral' | 'up' | 'down';
    className?: string;
}
/** Promoted from the design system's painel kit, as its README anticipated. */
export declare function Metric({ label, value, delta, tone, className }: MetricProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=Metric.d.ts.map