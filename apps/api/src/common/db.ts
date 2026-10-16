import './config';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
@Injectable()
export class Db extends PrismaClient implements OnModuleDestroy {
  async onModuleDestroy() { await this.$disconnect(); }
  async serial<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.$transaction(operation, { isolationLevel: 'Serializable', timeout: 15000 }); }
      catch (e: any) { if (e.code === 'P2034' && attempt < 4) continue; throw e; }
    }
  }
}
