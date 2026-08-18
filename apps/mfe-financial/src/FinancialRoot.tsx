import { Navigate, Route, Routes } from 'react-router-dom';
import { HostProvider, type RemoteRootProps } from '@ssm/mfe-runtime';
import { EmptyState } from '@ssm/ui-kit';
import { InvoiceListScreen } from './screens/InvoiceListScreen.js';
import { InvoiceDetailScreen } from './screens/InvoiceDetailScreen.js';

/**
 * Routes are declared relative to the module's base path — the shell mounts
 * this under /financeiro/* and never learns what is inside.
 */
export function FinancialRoot({ services }: RemoteRootProps) {
  return (
    // Re-provided through THIS module's copy of the context. The shell's
    // provider lives in a different copy of @ssm/mfe-runtime — see
    // RemoteRootProps in libs/mfe-runtime/src/module-contract.ts.
    <HostProvider value={services}>
      <Routes>
        <Route index element={<Navigate to="faturas" replace />} />
        <Route path="faturas" element={<InvoiceListScreen />} />
        <Route path="faturas/:id" element={<InvoiceDetailScreen />} />
        <Route
          path="relatorios"
          element={
            <EmptyState
              title="Relatórios em preparação"
              body="A posição de recebíveis e a exportação contábil entram na próxima entrega deste módulo."
            />
          }
        />
        <Route
          path="*"
          element={
            <EmptyState
              title="Tela não encontrada"
              body="Este endereço não existe dentro do módulo Financeiro."
            />
          }
        />
      </Routes>
    </HostProvider>
  );
}
