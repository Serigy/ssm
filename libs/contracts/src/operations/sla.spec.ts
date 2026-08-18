import { describe, expect, it } from 'vitest';
import { PENALTY_RULE, computeAvailabilityBps, computeSlaCredit } from './sla.js';

describe('computeAvailabilityBps', () => {
  it('devolve 100% quando não houve indisponibilidade', () => {
    expect(computeAvailabilityBps(43_200, 0)).toBe(10_000);
  });

  it('calcula em pontos-base, sem ponto flutuante', () => {
    // 43.200 minutos no mês, 294 fora do ar -> 99,3194% -> 9931 bps.
    expect(computeAvailabilityBps(43_200, 294)).toBe(9931);
  });

  it('arredonda para baixo, nunca a favor de quem presta o serviço', () => {
    // 9999,7 bps truncaria para 9999, não para 10000.
    expect(computeAvailabilityBps(100_000, 1)).toBe(9999);
  });

  it('trata um mês sem medição como disponível', () => {
    // Sem medição não há como afirmar indisponibilidade, e cobrar do
    // prestador por ausência de dado seria inverter o ônus.
    expect(computeAvailabilityBps(0, 0)).toBe(10_000);
  });
});

describe('computeSlaCredit', () => {
  const fee = 1_500_000; // R$ 15.000,00 — a mensalidade do contrato semeado

  it('não gera crédito quando a meta foi cumprida', () => {
    expect(computeSlaCredit(9_950, 9_950, fee)).toBe(0);
    expect(computeSlaCredit(9_990, 9_950, fee)).toBe(0);
  });

  it('não gera crédito para um desvio menor que um degrau', () => {
    // 0,3% abaixo não completa o degrau de 0,5%: "a cada 0,5% abaixo".
    expect(computeSlaCredit(9_920, 9_950, fee)).toBe(0);
  });

  it('desconta 5% da mensalidade a cada 0,5% abaixo da meta', () => {
    // 1% abaixo = 2 degraus = 10% de R$ 15.000,00 = R$ 1.500,00
    expect(computeSlaCredit(9_850, 9_950, fee)).toBe(150_000);
  });

  it('respeita o teto de 20% por mais grave que seja', () => {
    // 50% abaixo daria 500%; o contrato limita a 20%.
    expect(computeSlaCredit(4_950, 9_950, fee)).toBe(300_000);
    expect(computeSlaCredit(0, 9_950, fee)).toBe((fee * PENALTY_RULE.capBps) / 10_000);
  });

  it('permanece exato acima do limite seguro de inteiro do JavaScript', () => {
    // Uma mensalidade de 90 trilhões de centavos passa de 2^53 ao multiplicar
    // pelos pontos-base. O cálculo usa bigint por isso.
    const huge = 9_000_000_000_000;
    expect(computeSlaCredit(9_850, 9_950, huge)).toBe(900_000_000_000);
  });
});
