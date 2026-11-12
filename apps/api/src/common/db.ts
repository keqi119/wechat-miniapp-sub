import './config';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import {testScopedOptions} from './test-database-scope';
@Injectable()
export class Db extends PrismaClient implements OnModuleDestroy {
  constructor(options?:Prisma.PrismaClientOptions){super(testScopedOptions(options));}
  async onModuleDestroy() { await this.$disconnect(); }
  async serial<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.$transaction(operation, { isolationLevel: 'Serializable', timeout: 15000 }); }
      catch (e: any) {
        // SELECT ... FOR UPDATE reports PostgreSQL serialization/deadlock errors
        // through the raw-query wrapper rather than Prisma's P2034 code.
        const retryable=e.code==='P2034'||e.code==='P2010'&&['40001','40P01'].includes(e.meta?.code);
        if (retryable && attempt < 4) continue;
        throw e;
      }
    }
  }
}
