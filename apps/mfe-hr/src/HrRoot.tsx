import { Navigate, Route, Routes } from 'react-router-dom';
import { HostProvider, type RemoteRootProps } from '@ssm/mfe-runtime';
import { EmptyState } from '@ssm/ui-kit';
import { EmployeeListScreen } from './screens/EmployeeListScreen.js';
import { EmployeeDetailScreen } from './screens/EmployeeDetailScreen.js';
import { EmployeeCreateScreen } from './screens/EmployeeCreateScreen.js';

export function HrRoot({ services }: RemoteRootProps) {
  return (
    // Re-provided through THIS module's copy of the context. The shell's
    // provider lives in a different copy of @ssm/mfe-runtime — see
    // RemoteRootProps in libs/mfe-runtime/src/module-contract.ts.
    <HostProvider value={services}>
      <Routes>
        <Route index element={<Navigate to="colaboradores" replace />} />
        <Route path="colaboradores" element={<EmployeeListScreen />} />
        <Route path="colaboradores/novo" element={<EmployeeCreateScreen />} />
        <Route path="colaboradores/:id" element={<EmployeeDetailScreen />} />
        <Route
          path="folha"
          element={
            <EmptyState
              title="Folha em preparação"
              body="O fechamento e a conferência da folha entram na próxima entrega deste módulo."
            />
          }
        />
        <Route
          path="*"
          element={
            <EmptyState
              title="Tela não encontrada"
              body="Este endereço não existe no módulo Pessoas."
            />
          }
        />
      </Routes>
    </HostProvider>
  );
}
