import { Navigate, Route, Routes } from 'react-router-dom';
import { EmptyState } from '@ssm/ui-kit';
import { EmployeeListScreen } from './screens/EmployeeListScreen.js';
import { EmployeeDetailScreen } from './screens/EmployeeDetailScreen.js';

export function HrRoot() {
  return (
    <Routes>
      <Route index element={<Navigate to="colaboradores" replace />} />
      <Route path="colaboradores" element={<EmployeeListScreen />} />
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
        element={<EmptyState title="Tela não encontrada" body="Este endereço não existe no módulo Pessoas." />}
      />
    </Routes>
  );
}
