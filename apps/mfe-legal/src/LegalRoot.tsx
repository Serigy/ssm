import { Navigate, Route, Routes } from 'react-router-dom';
import { HostProvider, type RemoteRootProps } from '@ssm/mfe-runtime';
import { EmptyState } from '@ssm/ui-kit';
import { ContractListScreen } from './screens/ContractListScreen.js';
import { ContractDetailScreen } from './screens/ContractDetailScreen.js';
import { ExpiringScreen } from './screens/ExpiringScreen.js';

export function LegalRoot({ services }: RemoteRootProps) {
  return (
    // Re-provided through THIS module's copy of the context. The shell's
    // provider lives in a different copy of @ssm/mfe-runtime — see
    // RemoteRootProps in libs/mfe-runtime/src/module-contract.ts.
    <HostProvider value={services}>
      <Routes>
        <Route index element={<Navigate to="contratos" replace />} />
        <Route path="contratos" element={<ContractListScreen />} />
        <Route path="contratos/:id" element={<ContractDetailScreen />} />
        <Route path="vencimentos" element={<ExpiringScreen />} />
        <Route
          path="*"
          element={
            <EmptyState
              title="Tela não encontrada"
              body="Este endereço não existe no módulo Jurídico."
            />
          }
        />
      </Routes>
    </HostProvider>
  );
}
