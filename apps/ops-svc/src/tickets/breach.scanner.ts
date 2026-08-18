import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { TicketsService } from './tickets.service.js';

/**
 * Flags tickets whose first-response deadline passed with no response.
 *
 * A breach has to be recorded when it happens, not when someone next opens the
 * ticket. Otherwise a ticket nobody touched for a week would look compliant
 * until the moment it was finally answered — and the monthly reckoning would
 * quietly under-report.
 *
 * The update is a single conditional statement, so running it in every replica
 * is harmless: whoever gets there first flips the flag and the others match
 * nothing.
 */
@Injectable()
export class BreachScanner implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger(BreachScanner.name);
  private timer?: NodeJS.Timeout;
  private readonly intervalMs = 60_000;

  constructor(private readonly tickets: TicketsService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.scan(), this.intervalMs);
    setTimeout(() => void this.scan(), 15_000);
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  async scan(): Promise<void> {
    try {
      const flagged = await this.tickets.markBreaches();
      if (flagged > 0) {
        this.log.warn(`${flagged} chamado(s) passaram do prazo de primeira resposta.`);
      }
    } catch (err) {
      this.log.error(`Varredura de prazos falhou: ${(err as Error).message}`);
    }
  }
}
