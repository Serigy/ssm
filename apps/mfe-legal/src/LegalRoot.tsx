import { Navigate, Route, Routes } from 'react-router-dom';
import { EmptyState } from '@ssm/ui-kit';
import { ContractListScreen } from './screens/ContractListScreen.js';
import { ContractDetailScreen } from './screens/ContractDetailScreen.js';
import { ExpiringScreen } from './screens/ExpiringScreen.js';

export function LegalRoot() {
  return (
    <Routes>
      <Route index element={<Navigate to="contratos" replace />} />
      <Route path="contratos" element={<ContractListScreen />} />
      <Route path="contratos/:id" element={<ContractDetailScreen />} />
      <Route path="vencimentos" element={<ExpiringScreen />} />
      <Route
        path="*"
        element={<EmptyState title="Tela não encontrada" body="Este endereço não existe no módulo Jurídico." />}
      />
    </Routes>
  );
}
