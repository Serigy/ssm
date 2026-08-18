import { Component, type ErrorInfo, type ReactNode } from 'react';
interface Props {
    /** Module id, used in the fallback copy and the log line. */
    moduleId: string;
    children: ReactNode;
}
interface State {
    error: Error | null;
}
/**
 * Isolates one remote's failures from the rest of the application.
 *
 * This matters more in a federated app than in a monolith: a remote is fetched
 * from a separate origin at runtime, so it can fail in ways a bundled module
 * cannot — the deployment is mid-rollout, the CDN 404s, the chunk hash moved.
 * Without a boundary, any of those blanks the whole page including the two
 * modules that are perfectly healthy.
 */
export declare class RemoteBoundary extends Component<Props, State> {
    state: State;
    static getDerivedStateFromError(error: Error): State;
    componentDidCatch(error: Error, info: ErrorInfo): void;
    render(): ReactNode;
}
/** Boundary + Suspense in one wrapper, which is how the shell always uses it. */
export declare function RemoteSlot({ moduleId, children }: Props): import("react").JSX.Element;
export {};
//# sourceMappingURL=remote-boundary.d.ts.map