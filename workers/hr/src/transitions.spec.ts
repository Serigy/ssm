import { describe, expect, it } from 'vitest';
import type { EmploymentStatus } from '@ssm/contracts';
import { EMPLOYMENT_TRANSITIONS as T } from './commands.js';

/**
 * A máquina de estados do vínculo, testada como grafo.
 *
 * O bug que motivou este arquivo não estava dentro da tabela: ela permitia
 * `active -> offboarding`, e `offboarding -> terminated`, e o grafo fechava. O
 * buraco estava entre a tabela e as rotas — nenhum endpoint executava
 * `active -> offboarding`, e `offboard()` exigia `active -> terminated`, que a
 * tabela não permitia. Toda pessoa efetivamente trabalhando recebia 409 ao ser
 * desligada.
 *
 * Só um destes testes teria pegado aquilo: o que exige que se chegue a
 * `terminated` sem passo intermediário. Os demais valem por outra razão — eles
 * fixam propriedades do grafo que uma edição futura pode quebrar sem perceber,
 * como criar um estado sem saída. O que fecha de vez a classe do bug original é
 * exercitar a rota contra um colaborador ativo, e isso é teste de integração,
 * não de tabela.
 */
const ALL = Object.keys(T) as EmploymentStatus[];
const START: EmploymentStatus = 'applicant';

function reachableFrom(start: EmploymentStatus): Set<EmploymentStatus> {
  const seen = new Set<EmploymentStatus>([start]);
  const queue = [start];
  while (queue.length) {
    for (const next of T[queue.shift()!]) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

describe('máquina de estados do vínculo', () => {
  it('todo estado é alcançável a partir de candidato', () => {
    const reachable = reachableFrom(START);
    const orphans = ALL.filter((s) => !reachable.has(s));
    expect(orphans, `estados inalcançáveis: ${orphans.join(', ')}`).toEqual([]);
  });

  it('de todo estado se chega ao desligamento', () => {
    // Um vínculo que não pode terminar é vínculo que fica no relatório de
    // quadro ativo para sempre.
    const stuck = ALL.filter((s) => s !== 'terminated' && !reachableFrom(s).has('terminated'));
    expect(stuck, `estados sem saída para terminated: ${stuck.join(', ')}`).toEqual([]);
  });

  it('quem está trabalhando pode ser desligado sem passo intermediário', () => {
    // O caso que falhava: aviso prévio vencido, último dia hoje, e a rota
    // recusando porque active não alcançava terminated diretamente.
    expect(T.active).toContain('terminated');
    expect(T.on_leave).toContain('terminated');
  });

  it('quem está em aviso prévio pode ser desligado, e nada mais', () => {
    expect(T.offboarding).toEqual(['terminated']);
  });

  it('desligado é estado final', () => {
    expect(T.terminated).toEqual([]);
  });

  it('nenhum estado transiciona para si mesmo', () => {
    // Reativar quem já está ativo não é operação: seria mascarar um clique
    // repetido como se fosse mudança.
    const loops = ALL.filter((s) => T[s].includes(s));
    expect(loops, `estados com laço: ${loops.join(', ')}`).toEqual([]);
  });

  it('nenhuma transição aponta para estado que não existe', () => {
    const unknown = ALL.flatMap((s) => T[s].filter((t) => !ALL.includes(t)));
    expect(unknown).toEqual([]);
  });
});
