import { Navigate, Route, Routes } from 'react-router-dom';
import { HostProvider, type RemoteRootProps } from '@ssm/mfe-runtime';
import { EmptyState } from '@ssm/ui-kit';
import { EnvironmentListScreen } from './screens/EnvironmentListScreen.js';
import { TicketListScreen } from './screens/TicketListScreen.js';
import { TicketDetailScreen } from './screens/TicketDetailScreen.js';
import { TicketCreateScreen } from './screens/TicketCreateScreen.js';
import { SlaScreen } from './screens/SlaScreen.js';

export function OperationsRoot({ services }: RemoteRootProps) {
  return (
    // Re-provided through this module's own copy of the context — see
    // RemoteRootProps in libs/mfe-runtime/src/module-contract.ts.
    <HostProvider value={services}>
      <Routes>
        <Route index element={<Navigate to="chamados" replace />} />
        <Route path="ambientes" element={<EnvironmentListScreen />} />
        <Route path="chamados" element={<TicketListScreen />} />
        <Route path="chamados/novo" element={<TicketCreateScreen />} />
        <Route path="chamados/:id" element={<TicketDetailScreen />} />
        <Route path="sla" element={<SlaScreen />} />
        <Route
          path="*"
          element={
            <EmptyState
              title="Tela não encontrada"
              body="Este endereço não existe no módulo Operações."
            />
          }
        />
      </Routes>
    </HostProvider>
  );
}
